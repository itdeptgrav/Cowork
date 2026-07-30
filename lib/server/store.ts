import "server-only";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RoleArchetype, UserStatus } from "@/lib/domain";
import type { CredentialToken } from "./tokens";

/**
 * The identity store — accounts, organisations and sessions.
 *
 * **This is the seam.** Everything above it (route handlers, middleware, the
 * session) is production shape and stays as written; everything below it is one
 * adapter. Swapping to Postgres or Firestore means implementing `IdentityStore`
 * and changing the line at the bottom of this file, the same arrangement
 * `CoworkRepository` already uses for workspace data.
 *
 * The shipped adapter writes JSON to disk. It is honest about what it is: it
 * survives restarts and it is genuinely server-side — a browser cannot read it,
 * which is the property the whole exercise turns on — but it holds a process
 * lock rather than a database's, so it is correct for a single node and wrong
 * for a horizontally-scaled deploy. That limitation is written down rather than
 * discovered later, and it is exactly the line the interface exists to move.
 *
 * Nothing in here is the workspace. Tasks, scores and the rest still come from
 * `lib/repositories`; this owns only who you are and what you may be.
 */

export interface Organisation {
  id: string;
  name: string;
  createdAt: string;
  /** The account that created it. There is exactly one first administrator. */
  founderUserId: string;
}

export interface Account {
  id: string;
  organisationId: string;
  /** Lower-cased at write time — see `normaliseEmail`. */
  email: string;
  /** Digits only, no punctuation, so two spellings cannot both register. */
  phone: string;
  displayName: string;
  passwordHash: string;
  status: UserStatus;
  /**
   * Which kind of role this account holds, which is what decides where signin
   * lands them and what the middleware lets them open.
   *
   * Deliberately the domain's own `RoleArchetype` rather than a second
   * vocabulary invented for auth. A parallel enum is how "admin" comes to mean
   * one thing to the router and another to `can()`.
   */
  archetype: RoleArchetype;
  /**
   * The workspace identity this account acts as. `User.userId` on the employee
   * side points back, which is the link the domain already anticipated.
   */
  employeeId: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface SessionRecord {
  /** The opaque id inside the signed cookie. Never the cookie itself. */
  id: string;
  accountId: string;
  createdAt: string;
  expiresAt: string;
  /** Coarse, for the "signed in from" line and for revoking a stolen session. */
  userAgent: string | null;
}

/**
 * One employee's connected Gmail mailbox.
 *
 * Server-side because it holds credentials, and the workspace store is
 * `localStorage`. Legacy kept the refresh token in Firestore in PLAINTEXT, where
 * read access to one collection meant the ability to send mail as any connected
 * employee. Both tokens here are sealed with AES-256-GCM — see
 * `lib/server/secretBox.ts`.
 */
export interface GmailConnection {
  id: string;
  employeeId: string;
  /** The connected address, read from Google's userinfo — never typed. */
  email: string;
  /** AES-256-GCM. Never returned by any route. */
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiryDate: string;
  /** What Google actually granted, which can be narrower than what was asked. */
  scopes: string[];
  /** `revoked` is written when Google answers `invalid_grant`. */
  status: "active" | "expired" | "revoked";
  createdAt: string;
  updatedAt: string;
}

export interface IdentityStore {
  /* Gmail connections — one per employee. */
  findGmailConnection(employeeId: string): Promise<GmailConnection | null>;
  upsertGmailConnection(record: GmailConnection): Promise<void>;
  deleteGmailConnection(employeeId: string): Promise<void>;

  findAccountByEmail(email: string): Promise<Account | null>;
  findAccountByPhone(phone: string): Promise<Account | null>;
  findAccountById(id: string): Promise<Account | null>;
  /**
   * Everyone in one organisation.
   *
   * The workspace's employee list lives in a per-browser store, so a person
   * created or signed in on one machine was invisible on every other. This is
   * the only shared record of who exists, so it is what the workspace
   * reconciles against. Organisation-scoped by argument rather than by the
   * caller filtering afterwards — a directory that could return another
   * organisation's members is an enumeration oracle whether or not the caller
   * chooses to use it.
   */
  listAccountsByOrganisation(organisationId: string): Promise<Account[]>;
  findOrganisationById(id: string): Promise<Organisation | null>;
  createOrganisationWithFounder(input: {
    organisationName: string;
    displayName: string;
    email: string;
    phone: string;
    passwordHash: string;
  }): Promise<{ organisation: Organisation; account: Account }>;
  touchAccount(id: string, lastSeenAt: string): Promise<void>;

  /** Attach an account to an employee who had none — invitation redemption. */
  createAccountForEmployee(input: {
    organisationId: string;
    email: string;
    displayName: string;
    employeeId: string;
    passwordHash: string;
    archetype: RoleArchetype;
  }): Promise<Account>;
  setPassword(accountId: string, passwordHash: string): Promise<void>;

  listTokens(): Promise<CredentialToken[]>;
  createToken(record: CredentialToken): Promise<void>;
  deleteToken(tokenHash: string): Promise<void>;
  /** Every outstanding token for one address, so re-issuing supersedes. */
  deleteTokensForEmail(email: string): Promise<void>;

  createSession(record: SessionRecord): Promise<void>;
  findSession(id: string): Promise<SessionRecord | null>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(now: string): Promise<void>;

  /** Whether any organisation exists yet — the first signup is special. */
  isEmpty(): Promise<boolean>;
}

/* ── Normalisation ────────────────────────────────────────────────────────── */

/**
 * One spelling per address.
 *
 * Case-folded and trimmed, because `Maya@Example.com` and `maya@example.com`
 * are the same mailbox and letting both register creates two accounts that
 * cannot both be signed into. Gmail's dot and `+tag` rules are deliberately NOT
 * applied: they are Gmail's, not the internet's, and folding them would merge
 * distinct addresses at other providers.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Digits only, with a leading `+` preserved.
 *
 * `+44 7700 900123`, `+447700900123` and `+44-7700-900123` are one number, and
 * the uniqueness check has to agree with that or "existing phone number" never
 * fires for anyone who types a space.
 */
export function normalisePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export function emailProblem(raw: string): string | null {
  const email = normaliseEmail(raw);
  if (!email) return "Enter your email address.";
  /* Deliberately permissive. Over-strict address validation rejects real,
     RFC-legal mailboxes, and the only test that actually proves an address
     works is sending to it. */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return "That does not look like an email address.";
  if (email.length > 254) return "That email address is too long.";
  return null;
}

export function phoneProblem(raw: string): string | null {
  const phone = normalisePhone(raw);
  if (!phone) return "Enter a phone number.";
  const digits = phone.replace(/\D/g, "");
  /* E.164 allows up to 15 digits; below 7 is not a reachable number anywhere. */
  if (digits.length < 7 || digits.length > 15)
    return "Enter a phone number including the country code.";
  return null;
}

/* ── The file-backed adapter ──────────────────────────────────────────────── */

interface Snapshot {
  version: 1;
  organisations: Organisation[];
  accounts: Account[];
  sessions: SessionRecord[];
  tokens: CredentialToken[];
  /** Optional: a file written before Gmail existed has none. */
  gmailConnections?: GmailConnection[];
}

const EMPTY: Snapshot = {
  version: 1,
  organisations: [],
  accounts: [],
  sessions: [],
  tokens: [],
};

const DATA_PATH =
  process.env.COWORK_IDENTITY_PATH ?? join(process.cwd(), ".data", "identity.json");

class FileIdentityStore implements IdentityStore {
  /**
   * Every mutation runs through one promise chain.
   *
   * Route handlers are concurrent, and read-modify-write on a JSON file is a
   * lost-update waiting to happen: two signups landing together would each read
   * the same snapshot and the second would erase the first. Serialising is the
   * whole reason a real database belongs here eventually — but a single node
   * with a queue is correct, and a single node without one is not.
   */
  #chain: Promise<unknown> = Promise.resolve();
  #cache: Snapshot | null = null;
  #cachedMtime = -1;

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(fn, fn);
    /* Swallow on the CHAIN only, so one failed write cannot poison every
       subsequent one — the caller still sees its own rejection. */
    this.#chain = next.catch(() => undefined);
    return next;
  }

  /**
   * Re-read when the file has changed underneath us.
   *
   * The cache used to be read-once, and that was wrong in a way a test caught:
   * editing an account on disk — demoting an administrator, restoring a backup,
   * anything an operator would reasonably do — had no effect until the process
   * restarted, and the endpoint went on answering from a stale snapshot. A
   * privilege change that does not take effect is the worst possible one to get
   * wrong.
   *
   * An mtime comparison rather than a watcher: one `stat` per read is cheaper
   * than the bookkeeping, and it stays correct if the file is replaced rather
   * than written in place. It does NOT make this safe across processes — two
   * nodes still interleave writes — which remains the reason the interface
   * exists.
   */
  async #read(): Promise<Snapshot> {
    let mtime = 0;
    try {
      mtime = (await stat(DATA_PATH)).mtimeMs;
    } catch {
      /* No file yet. Falls through to the empty snapshot below on first read,
         and stays cached afterwards because mtime 0 never changes. */
    }
    if (this.#cache && mtime === this.#cachedMtime) return this.#cache;
    this.#cachedMtime = mtime;

    try {
      const raw = await readFile(DATA_PATH, "utf8");
      const parsed = JSON.parse(raw) as Snapshot;
      this.#cache =
        parsed && parsed.version === 1
          ? { ...EMPTY, ...parsed }
          : structuredClone(EMPTY);
    } catch {
      /* Missing or unreadable is an empty store, not an error: the first run of
         a fresh deployment has no file and must still be able to sign up. */
      this.#cache = structuredClone(EMPTY);
    }
    return this.#cache;
  }

  /** Write to a sibling then rename — a torn file is an unopenable product. */
  async #write(next: Snapshot): Promise<void> {
    this.#cache = next;
    await mkdir(dirname(DATA_PATH), { recursive: true });
    const tmp = `${DATA_PATH}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, DATA_PATH);
    /* We just wrote it, so the cache IS current — record the new stamp rather
       than letting the next read decide the file changed and re-parse it. */
    try {
      this.#cachedMtime = (await stat(DATA_PATH)).mtimeMs;
    } catch {
      this.#cachedMtime = -1;
    }
  }

  async isEmpty(): Promise<boolean> {
    return (await this.#read()).organisations.length === 0;
  }

  async findAccountByEmail(email: string): Promise<Account | null> {
    const s = await this.#read();
    const key = normaliseEmail(email);
    return s.accounts.find((a) => a.email === key) ?? null;
  }

  async findAccountByPhone(phone: string): Promise<Account | null> {
    const s = await this.#read();
    const key = normalisePhone(phone);
    return s.accounts.find((a) => a.phone === key) ?? null;
  }

  async findAccountById(id: string): Promise<Account | null> {
    const s = await this.#read();
    return s.accounts.find((a) => a.id === id) ?? null;
  }

  async findGmailConnection(employeeId: string): Promise<GmailConnection | null> {
    const s = await this.#read();
    return (
      (s.gmailConnections ?? []).find((g) => g.employeeId === employeeId) ?? null
    );
  }

  async upsertGmailConnection(record: GmailConnection): Promise<void> {
    /* Serialised like every other write: a refresh and a disconnect racing each
       other must not resurrect a revoked credential. */
    return this.#serial(async () => {
      const s = await this.#read();
      const rest = (s.gmailConnections ?? []).filter(
        (g) => g.employeeId !== record.employeeId,
      );
      await this.#write({ ...s, gmailConnections: [...rest, record] });
    });
  }

  async deleteGmailConnection(employeeId: string): Promise<void> {
    return this.#serial(async () => {
      const s = await this.#read();
      await this.#write({
        ...s,
        gmailConnections: (s.gmailConnections ?? []).filter(
          (g) => g.employeeId !== employeeId,
        ),
      });
    });
  }

  async listAccountsByOrganisation(organisationId: string): Promise<Account[]> {
    const s = await this.#read();
    return s.accounts.filter((a) => a.organisationId === organisationId);
  }

  async findOrganisationById(id: string): Promise<Organisation | null> {
    const s = await this.#read();
    return s.organisations.find((o) => o.id === id) ?? null;
  }

  async createOrganisationWithFounder(input: {
    organisationName: string;
    displayName: string;
    email: string;
    phone: string;
    passwordHash: string;
  }): Promise<{ organisation: Organisation; account: Account }> {
    return this.#serial(async () => {
      const s = await this.#read();
      const email = normaliseEmail(input.email);
      const phone = normalisePhone(input.phone);

      /* Re-checked INSIDE the lock. The route handler checks first to produce a
         good field-level message, but that check and this write are not atomic,
         and two simultaneous signups with the same address would both pass it.
         This is the one that actually holds the invariant. */
      if (s.accounts.some((a) => a.email === email))
        throw new UniqueViolation("email");
      if (s.accounts.some((a) => a.phone === phone))
        throw new UniqueViolation("phone");

      const now = new Date().toISOString();
      const userId = `u-${cryptoId()}`;
      const org: Organisation = {
        id: `org-${cryptoId()}`,
        name: input.organisationName.trim(),
        createdAt: now,
        founderUserId: userId,
      };
      const account: Account = {
        id: userId,
        organisationId: org.id,
        email,
        phone,
        displayName: input.displayName.trim(),
        passwordHash: input.passwordHash,
        status: "active",
        /* The founder is the administrator. Stated here rather than passed in,
           because "whoever signs up first is an admin" is a rule about the
           product, not a parameter a caller should be able to set — an endpoint
           that accepted an archetype would be a privilege-escalation hole. */
        archetype: "system_admin",
        employeeId: `e-${cryptoId()}`,
        createdAt: now,
        lastSeenAt: null,
      };

      await this.#write({
        ...s,
        organisations: [...s.organisations, org],
        accounts: [...s.accounts, account],
      });
      return { organisation: org, account };
    });
  }

  async touchAccount(id: string, lastSeenAt: string): Promise<void> {
    return this.#serial(async () => {
      const s = await this.#read();
      await this.#write({
        ...s,
        accounts: s.accounts.map((a) =>
          a.id === id ? { ...a, lastSeenAt } : a,
        ),
      });
    });
  }

  async createAccountForEmployee(input: {
    organisationId: string;
    email: string;
    displayName: string;
    employeeId: string;
    passwordHash: string;
    archetype: RoleArchetype;
  }): Promise<Account> {
    return this.#serial(async () => {
      const s = await this.#read();
      const email = normaliseEmail(input.email);
      const existing = s.accounts.find((a) => a.email === email);
      if (existing) throw new UniqueViolation("email");

      const account: Account = {
        id: `u-${cryptoId()}`,
        organisationId: input.organisationId,
        email,
        /* No phone. Signup collects one because it is the founder's own
           account; an invited colleague has not been asked for theirs, and
           inventing a placeholder would put a fake number in a unique index. */
        phone: "",
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        status: "active",
        archetype: input.archetype,
        employeeId: input.employeeId,
        createdAt: new Date().toISOString(),
        lastSeenAt: null,
      };
      await this.#write({ ...s, accounts: [...s.accounts, account] });
      return account;
    });
  }

  async setPassword(accountId: string, passwordHash: string): Promise<void> {
    return this.#serial(async () => {
      const s = await this.#read();
      await this.#write({
        ...s,
        accounts: s.accounts.map((a) =>
          a.id === accountId ? { ...a, passwordHash } : a,
        ),
        /* Every session dies with the password. A reset exists precisely
           because the old credential may be compromised, and leaving the
           thief's session alive would make the reset cosmetic. */
        sessions: s.sessions.filter((x) => x.accountId !== accountId),
      });
    });
  }

  async listTokens(): Promise<CredentialToken[]> {
    return (await this.#read()).tokens;
  }

  async createToken(record: CredentialToken): Promise<void> {
    return this.#serial(async () => {
      const s = await this.#read();
      await this.#write({ ...s, tokens: [...s.tokens, record] });
    });
  }

  async deleteToken(tokenHash: string): Promise<void> {
    return this.#serial(async () => {
      const s = await this.#read();
      await this.#write({
        ...s,
        tokens: s.tokens.filter((t) => t.tokenHash !== tokenHash),
      });
    });
  }

  async deleteTokensForEmail(email: string): Promise<void> {
    return this.#serial(async () => {
      const s = await this.#read();
      const key = normaliseEmail(email);
      await this.#write({
        ...s,
        tokens: s.tokens.filter((t) => t.email !== key),
      });
    });
  }

  async createSession(record: SessionRecord): Promise<void> {
    return this.#serial(async () => {
      const s = await this.#read();
      await this.#write({ ...s, sessions: [...s.sessions, record] });
    });
  }

  async findSession(id: string): Promise<SessionRecord | null> {
    const s = await this.#read();
    return s.sessions.find((x) => x.id === id) ?? null;
  }

  async deleteSession(id: string): Promise<void> {
    return this.#serial(async () => {
      const s = await this.#read();
      await this.#write({
        ...s,
        sessions: s.sessions.filter((x) => x.id !== id),
      });
    });
  }

  async deleteExpiredSessions(now: string): Promise<void> {
    return this.#serial(async () => {
      const s = await this.#read();
      const live = s.sessions.filter((x) => x.expiresAt > now);
      if (live.length === s.sessions.length) return;
      await this.#write({ ...s, sessions: live });
    });
  }
}

/** Thrown inside the write lock; the route turns it into a field error. */
export class UniqueViolation extends Error {
  constructor(public field: "email" | "phone") {
    super(`${field} already registered`);
    this.name = "UniqueViolation";
  }
}

function cryptoId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * The one line to change when this moves to a real database.
 *
 * A module singleton rather than a per-request instance, so the write queue and
 * the cache are shared across handlers in the process — which is what makes the
 * serialisation above mean anything.
 */
export const identityStore: IdentityStore = new FileIdentityStore();
