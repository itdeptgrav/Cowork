/**
 * A tiny LRU with TTL, plus in-flight de-duplication.
 *
 * This is load-bearing, not an optimisation. `search.list` costs 100 of the
 * project's 10,000 daily units, so a repeated query that hits the network is a
 * real loss of a scarce resource. Caching makes recent searches, back
 * navigation and two people searching the same thing free.
 *
 * Process-local by design: it lives in the route handler's memory. A serverless
 * deployment gets one cache per warm instance, which is still worth having;
 * a shared cache would be the next step and would not change the interface.
 */

interface Entry<T> {
  value: T;
  expires: number;
}

export class TtlCache<T> {
  #map = new Map<string, Entry<T>>();
  #inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const hit = this.#map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.#map.delete(key);
      return undefined;
    }
    // Re-insert so Map iteration order stays least-recently-used first.
    this.#map.delete(key);
    this.#map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.#map.size >= this.max) {
      const oldest = this.#map.keys().next().value;
      if (oldest !== undefined) this.#map.delete(oldest);
    }
    this.#map.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  /**
   * Returns the cached value, or runs `load` — sharing one in-flight promise
   * across concurrent callers so two simultaneous identical searches spend one
   * quota unit rather than two.
   */
  async remember(
    key: string,
    load: () => Promise<T>,
  ): Promise<{ value: T; cached: boolean }> {
    const hit = this.get(key);
    if (hit !== undefined) return { value: hit, cached: true };

    const existing = this.#inflight.get(key);
    if (existing) return { value: await existing, cached: true };

    const p = load()
      .then((v) => {
        this.set(key, v);
        return v;
      })
      .finally(() => this.#inflight.delete(key));

    this.#inflight.set(key, p);
    return { value: await p, cached: false };
  }
}

/**
 * Daily quota accounting.
 *
 * Approximate on purpose — it counts what this instance spent, not what the
 * project spent. Its job is to fail early and legibly as the ceiling nears
 * rather than to be an exact ledger.
 */
class QuotaMeter {
  #spent = 0;
  #day = today();

  spend(units: number): void {
    this.roll();
    this.#spent += units;
  }

  get spent(): number {
    this.roll();
    return this.#spent;
  }

  private roll() {
    const d = today();
    if (d !== this.#day) {
      this.#day = d;
      this.#spent = 0;
    }
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const quota = new QuotaMeter();
