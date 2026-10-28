# Local account completion plan

Goal: Complete the user's GiroTrack-only local account requirements without changing the login design or existing business data.

Architecture: Keep the workspace-backed account/session records and HttpOnly cookie. Add atomic database throttling, strict session checks, versioned password hashing and safe local initialization. Use a separate persistence directory and port for all temporary browser accounts.

1. Write failing security tests, fix password/session policies and account routes, verify regression cases.
2. Add an idempotent local initializer and explicit isolated persistence setting; verify real data read-only and initialize isolated storage.
3. Exercise first-account creation, added users, sign-in/out, refresh and server restart in browser. Exercise private API denial, throttling and expired/revoked sessions in isolated API tests.
4. Run type checks and tests, review changes, verify real database snapshot is unchanged, leave real first-account setup ready.

Constraints: No cloud deployment. No real test accounts. Preserve prior UI changes and all payers/payments/files/vault keys. Account permissions remain shared workspace permissions.
