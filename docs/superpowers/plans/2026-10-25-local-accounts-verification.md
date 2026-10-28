# Local account verification — 2026-10-25

- Preserved GiroTrack login layout and branding. Accounts are independent of GiroWatch.
- 33 automated tests passed; TypeScript check passed. Security review found no blocking findings.
- Browser exercised first-account creation, add-user success without changing actor, sign-out, second-user sign-in, invalid-password error, expired-session rejection, and session/page restoration after refresh and server restart. No login animation on refresh.
- Isolated HTTP checks exercised all six supported private API methods anonymously (401), unauthenticated user creation (401), cross-origin mutations (403), authenticated encrypted credential storage and file upload/download, cookie flags, revoked-cookie replay, concurrent login throttling (five 401 / three 429), and persisted throttle state after restart.
- Two normal local initialization runs preserved every database row and version exactly.
- At the user's explicit request, removed only `auth:` records from the real database. All other rows and versions matched the pre-test snapshot exactly. No test accounts were created in real storage.
- Normal app left running at http://127.0.0.1:5173 on first-account creation. Real data persists under `.wrangler/state`; encryption key remains in `.dev.vars`. No cloud deployment required.

Password hashing parameters follow the scrypt options in [OWASP's password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Native crypto support was checked against [Cloudflare's node:crypto documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/) and verified in the actual local worker runtime.

Final-state note: after the reset and verified first-account screen, the running normal server received account creation and sign-in requests outside the isolated test workflow. That new account was preserved. The final browser screen is sign-in; the agent did not create any real account.
