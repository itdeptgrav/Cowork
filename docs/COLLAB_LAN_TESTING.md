# Testing live document collaboration across two computers

Socket.IO + Yjs is the **only** live path. There is no Firestore sync provider
for documents, and there must not be a second one — two paths writing the same
document is how documents get corrupted.

## The rule that matters

**One backend process. Ever.**

The live Yjs document lives in the backend process's memory; Firestore only
holds periodic snapshots. Two backends means two separate rooms that never
exchange an edit — and both write snapshots to the same `ydocState`, so
last-save-wins silently discards the other machine's work.

This is worse than not working, because both machines read the same Firestore
document list and it *looks* connected.

> **Computer B must not run `npm run dev` in `grav-cms-backend`.**
> It must not run the Cowork frontend either — it opens computer A's.

## Setup

Everything is environment configuration. **No LAN address appears in
application logic**, so replacing these with the production backend URL is the
only change needed to go live.

### Computer A (the host) — runs everything

| Where | Setting |
|---|---|
| `grav-cms-backend/.env` | `EXTRA_ALLOWED_ORIGINS=http://<A-LAN-IP>:3000` |
| `cowork/.env.local` | `NEXT_PUBLIC_LEGACY_API_URL=http://<A-LAN-IP>:5050` |
| `cowork/package.json` | `"dev": "next dev -H 0.0.0.0"` |

`EXTRA_ALLOWED_ORIGINS` is comma-separated and gates **both** the CORS
middleware and the Socket.IO handshake. Leave it unset in production.

`NEXT_PUBLIC_LEGACY_API_URL` drives the HTTP calls **and** the collaboration
socket — `lib/documents/collabProvider.ts` reads it through `readConfig()`, so
there is one value to change, not two.

Then, on computer A only:

```bash
cd grav-cms-backend && npm run dev     # :5050
cd cowork            && npm run dev    # :3000, bound to 0.0.0.0
```

### Finding the LAN IP

```bash
ipconfig getifaddr en0        # macOS
```

It changes when you rejoin a network. When it does, update the two env values
and restart both processes — nothing else.

## The URLs to open

Both computers open the **same** address. Computer A does **not** use
`localhost`, or its browser will send `Origin: http://localhost:3000` and the
two machines will disagree about who they are.

```
Computer A →  http://<A-LAN-IP>:3000/workspace
Computer B →  http://<A-LAN-IP>:3000/workspace
```

## Two signed-in users

Collaboration is per-person, so two browsers signed in as the same employee show
one caret with one name. To see it properly you need two accounts.

1. On **A**, sign in as yourself. Open **Workspace → Documents**, create one.
2. Open **Share**. Add the second employee as **Editor** (or **Viewer**, to test
   the read-only gate). Only an owner sees the Share button.
3. On **B**, sign in as that second employee — a real account with a
   `cowork_employees` record. A browser profile or private window keeps the two
   sessions apart on one machine.
4. On **B**, open the same URL and choose the document from the list. It only
   appears if step 2 actually added them.

### What you should see

- The footer on both reads **"Edits are shared live…"**
- The header shows a green dot and **"2 editing"**
- Typing on one appears on the other, with a named, coloured caret
- A **Viewer** gets no toolbar, cannot type, and the footer says
  *"You have view access."* — the server refuses their edits regardless of the UI

### If it says something else

The footer reports the real reason rather than a generic "offline":

| Message | Cause |
|---|---|
| `Waiting for your profile…` | employee record still loading |
| `Not signed in to the engine…` | no Firebase ID token — sign in again |
| `Unauthorized: not in this document` | not added via Share |
| `Unauthorized: sign in again` | token invalid or expired |
| `Not allowed by CORS` | this origin is missing from `EXTRA_ALLOWED_ORIGINS` |

## Confirming both are in the same room

The room name is the document id, and the namespace is `/yjs|<documentId>` —
derived on the server from `socket.nsp.name`, never from anything the client
sends. Two browsers open on the same document are in the same room by
construction.

To see it, watch computer A's backend log:

```
[docs] room ready <documentId> (restored)
```

That line appears **once per document**, on the first connection. A second line
with the same id would mean a second backend — which is the failure this
document exists to prevent.

## Going to production

Set `NEXT_PUBLIC_LEGACY_API_URL` to the deployed backend, add the deployed
frontend origin to the allow-list, and unset `EXTRA_ALLOWED_ORIGINS`. None of
this is a code change — which is the point of keeping the address out of the
application entirely.
