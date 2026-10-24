declare namespace Cloudflare {
  interface Env {
    GIROTRACK_VAULT_KEY?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
