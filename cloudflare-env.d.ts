declare namespace Cloudflare {
  interface Env {
    GIROTRACK_VAULT_KEY?: string;
    /** Id of GIROTRACK_VAULT_KEY (default "1") and earlier keys still needed to read older values (see lib/vault.mjs). */
    GIROTRACK_VAULT_KEY_ID?: string;
    GIROTRACK_VAULT_OLD_KEYS?: string;
    /** Shared secret IIS adds as X-GiroTrack-Proxy, so its X-Forwarded-For can be trusted (see clientAddress). */
    GIROTRACK_PROXY_SECRET?: string;
    /** The HTTPS address people open when GiroTrack runs behind a reverse proxy (see lib/public-origin.mjs). */
    GIROTRACK_PUBLIC_ORIGIN?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
