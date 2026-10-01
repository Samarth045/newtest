# My Money Control — Cloud Sync (Phase 2)

This directory contains the Cloudflare Worker + D1 backend for the PWA.

## Architecture

GitHub Pages PWA
→ HTTPS Worker API
→ Cloudflare D1

The browser remains offline-first. Local IndexedDB is the working copy; D1 is the independent cloud copy.

## Setup

1. Create a Cloudflare account.
2. Create a D1 database named `my-money-control`.
3. Put its database ID in `wrangler.toml`.
4. Apply the schema:

```bash
npx wrangler d1 execute my-money-control --remote --file=schema.sql
```

5. Deploy:

```bash
npx wrangler deploy
```

6. Test:

```text
https://YOUR-WORKER.workers.dev/health
```

## Security model

Each vault has a random vault ID and a random client secret. Only a SHA-256 hash of the secret is stored in D1. The raw secret is never sent back by the server.

The worker rejects requests from origins other than the GitHub Pages app or localhost development origins.

## Conflict model

Every cloud write includes the revision the device last read.

If another device has already changed the vault, the Worker returns HTTP 409 instead of overwriting the newer cloud copy. The incoming payload is retained in `sync_conflicts`.

This is deliberate: preserving both versions is safer than silent last-write-wins for financial records.

## Important

Do not commit a real vault secret or Cloudflare API token to GitHub.
