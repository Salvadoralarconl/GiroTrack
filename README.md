# GiroTrack application

## Requirements

Node.js 22.13 or newer and pnpm 11.25.0. The application uses Vinext, React, and Cloudflare D1/R2 local emulation.

## Local development

From this directory:

1. Run `pnpm install`.
2. Run `pnpm run local:setup`. This configures the DB/BUCKET bindings, creates the local workspace table if missing, and creates a vault key only when `.dev.vars` does not exist. It never deletes records or replaces an existing key. No Cloudflare account or deployment is required.
3. Run `pnpm run dev` and open http://127.0.0.1:5173. Keep using the same hostname so the browser can send its session cookie.
4. Create the first user account. Existing users can add people from their sidebar account menu. Each person signs in with their own email/password, sharing the workspace. New activity is attributed by the server to the signed-in user. Historical activity keeps its original attribution.

New account passwords use salted scrypt hashes (N=32768, r=8, p=3). Legacy PBKDF2 hashes remain compatible and upgrade on successful sign-in. Portal passwords and authenticator seeds are encrypted with AES-256-GCM using versioned keys (`GIROTRACK_VAULT_KEY`, see `lib/vault.mjs`). Signing in is per browser tab: every API request needs the HttpOnly, SameSite=Strict session cookie (a browser-session cookie, Secure on HTTPS) plus that tab's token in the `X-GiroTrack-Tab` header; a reload keeps the tab signed in, a new or reopened tab signs in again (`lib/tab-session.ts`). Ten failed passwords lock an account for 15 minutes (atomic, persisted counters), with an additional per-address limit and a separate limit for authenticator codes. Account creation after the first account requires the Manager. Vendor password retrievals and changes are recorded per vendor (`lib/credential-log.mjs`).

Do not replace an existing vault key: doing so prevents opening previously encrypted portal passwords. Back up `.wrangler/state` and `.dev.vars` privately if you need to preserve local data. Neither belongs in Git.

## Checks

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test lib/*.test.mjs
```

The older `scripts/integration-test.mjs` predates user accounts and mutates/restores the workspace. Do not run it against a workspace containing real data.

## Notes

Calendar payments are schedules, independent of invoices. Recording payment status tracks payments made elsewhere; GiroTrack does not transfer money. PDF/OCR runs locally with bundled assets, without sending documents to an external AI service.

The first account is the Manager, who adds people, resets their passwords and removes them; everyone else is a Member with the same access to records. Forgotten passwords are recovered with an authenticator app code; there is no email delivery.

## Running on a server

To host GiroTrack on an internal server (built app, Windows service, IIS with HTTPS, protected secrets, backups, key rotation), follow [docs/girosol-server-setup.md](docs/girosol-server-setup.md). In short: `pnpm run build`, then `pnpm start` runs it on `127.0.0.1` (port `GIROTRACK_PORT`, default 8788) with secrets from `GIROTRACK_SECRETS_FILE` (default `.dev.vars`), and refuses to start without a valid key. `node scripts/vault-keys.mjs` checks and rotates encryption keys.

## Isolated account verification

For a disposable test instance, set `GIROTRACK_LOCAL_STATE` to a separate directory (for example `tmp/account-browser-state`) before both `pnpm run local:setup` and starting Vite on another port. The normal app uses `.wrangler/state` by default. Do not point tests at the real state directory. Only run one Vite instance per checkout at a time.

`wrangler.local.json` targets only the local emulator; initialization always passes `--local`. Both initialization and Vite use the same stable database identifier and persistence directory. Back up `.wrangler/state` and `.dev.vars` together privately. Do not delete these directories when restarting or importing code updates. Git does not contain your local accounts or business data.

GiroTrack accounts are independent of GiroWatch. No GiroWatch account, cloud identity, or GitHub login grants access. The first account screen is available only when no GiroTrack user records exist. The public `/api/account` endpoint supports setup, sign-in and sign-out; `/api/workspace`, `/api/files`, and `/api/credentials` require a valid session for every supported method. All authenticated users share workspace permissions.
