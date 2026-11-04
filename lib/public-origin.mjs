// Behind a reverse proxy (IIS on the Girosol server) GiroTrack receives requests
// at http://127.0.0.1:<port> while browsers use the proxy's HTTPS address.
// GIROTRACK_PUBLIC_ORIGIN names that address; requests are treated as arriving
// there, so the same-origin check matches the browser's Origin and session
// cookies get the Secure flag. Only safe while GiroTrack itself is reachable
// from the server alone (the start script binds 127.0.0.1).

/** The configured origin ("https://host[:port]"), or null when unset. Throws when malformed. */
export function parsePublicOrigin(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:' || url.origin !== value.replace(/\/$/, '')) throw Error('GIROTRACK_PUBLIC_ORIGIN must be the HTTPS address people open, like https://girotrack.girosol.local');
  return url.origin;
}

/** The request as if it arrived at `origin` (same path, query, method, headers and body). */
export function atPublicOrigin(request, origin) {
  if (!origin) return request;
  const url = new URL(request.url);
  return new Request(origin + url.pathname + url.search, request);
}
