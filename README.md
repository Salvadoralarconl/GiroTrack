# GiroTrack application

## Requirements

Node.js 22.13 or newer and pnpm 11.25.0. The application uses Vinext, React, and Cloudflare D1/R2 local emulation.

## Local development

From this directory:

1. Run `pnpm install`.
2. Create `.openai/hosting.json` with local binding configuration:
   ```json
   { "d1": "DB", "r2": "BUCKET" }
   ```
3. Create a local vault key in the ignored `.dev.vars` file. Run this only for a fresh checkout; preserve the existing key if you already have saved credentials:
   ```sh
   node -e "require('fs').writeFileSync('.dev.vars','GIROTRACK_VAULT_KEY='+require('crypto').randomBytes(32).toString('base64')+'\n',{flag:'wx'})"
   ```
4. Run `pnpm run build`. This also prepares the local PDF and OCR assets.
5. Initialize the local database:
   ```sh
   node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_elite_bloodstrike.sql
   ```
6. Run `pnpm run dev` and open http://127.0.0.1:5173.
7. Create the first user account. Existing users can add people from their sidebar account menu. Each person signs in with their own email/password, sharing the workspace. New activity is attributed by the server to the signed-in user. Historical activity keeps its original attribution.

Account passwords are salted PBKDF2 hashes. Portal passwords are separately encrypted with AES-GCM using `GIROTRACK_VAULT_KEY`. Sessions use HttpOnly cookies. All record, file, and credential APIs require a session.

Do not replace an existing vault key: doing so prevents opening previously encrypted portal passwords. Back up `.wrangler/state` and `.dev.vars` privately if you need to preserve local data. Neither belongs in Git.

## Checks

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test lib/*.test.mjs
```

The older `scripts/integration-test.mjs` predates user accounts and mutates/restores the workspace. Do not run it against a workspace containing real data.

## Notes

Calendar payments are schedules, independent of invoices. Recording payment status tracks payments made elsewhere; GiroTrack does not transfer money. PDF/OCR runs locally with bundled assets, without sending documents to an external AI service.

Email verification, password-reset email delivery, and user roles are not configured. Accounts currently share the same workspace permissions. The local app is not publicly deployed by these instructions.
