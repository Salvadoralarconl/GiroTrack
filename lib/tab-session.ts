'use client';
// Tab-scoped sign-in, browser side. The server requires two things on every
// API request: the HttpOnly session cookie and this tab's token, sent as the
// X-GiroTrack-Tab header (never in a URL). The token lives in this tab's memory
// and sessionStorage, so a reload keeps the tab signed in; a new tab starts
// without one and signs in itself.
//
// sessionStorage can be copied (Duplicate tab) or restored (Reopen closed tab,
// browser session restore), so it is not trusted alone. A stored token is only
// used when all of these hold:
// - the browser reports this page load as a reload (not a new visit, a
//   restored or reopened tab, or a back/forward visit);
// - the server still accepts it: when a page goes away it reports it
//   (tab-suspend), and from then on the token only works to resume, for 15
//   seconds — enough for a reload, not for reopening a closed tab later;
// - no other open GiroTrack tab is using it right now (a duplicate);
// - resuming trades it for a new token (single use), so only one copy can stay valid.
// If the going-away report never arrives (crash, killed browser), the server
// ends the tab 3 minutes after its last check-in.
// Tradeoff: page scripts can read the token (needed to send the header). It is
// useless without the HttpOnly cookie and expires quickly, but script injected
// into GiroTrack could still act as the signed-in person while the tab is open.

const KEY = 'girotrack-tab';
export const TAB_HEADER = 'X-GiroTrack-Tab';
let token = '';

export function setTab(next: string) {
  token = next;
  try {
    sessionStorage.setItem(KEY, next);
  } catch {}
}

export function clearTab() {
  token = '';
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

export function storedTab(): string {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

// The other tabs only ever see the token's first 16 characters (same-origin channel).
const CHANNEL = 'girotrack-tabs';
const idOf = (t: string) => t.slice(0, 16);

/** True when another open GiroTrack tab is using this token right now. */
export function heldElsewhere(t: string): Promise<boolean> {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(CHANNEL);
    const finish = (held: boolean) => {
      channel.close();
      resolve(held);
    };
    channel.onmessage = (e) => {
      if (e.data?.type === 'mine' && e.data.id === idOf(t)) finish(true);
    };
    channel.postMessage({ type: 'who', id: idOf(t) });
    setTimeout(() => finish(false), 250);
  });
}

/** True when the browser reports this page load as a reload of the same tab. */
export function loadedByReload(): boolean {
  const entry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  return entry?.type === 'reload';
}

/** Fired when the page comes back from the back/forward cache: its token was suspended on the way out. */
export const TAB_RETURNED = 'girotrack-tab-returned';

let installed = false;

/** Adds this tab's token to GiroTrack's own API requests, and answers duplicate checks. Runs once per page. */
export function installTabSession() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (!token || url.origin !== location.origin || !url.pathname.startsWith('/api/')) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(TAB_HEADER)) headers.set(TAB_HEADER, token);
    return original(input, { ...init, headers });
  };
  // Going away (closing, reloading, leaving for another site): tell the server, which then accepts the
  // token only to resume, briefly. keepalive lets the request finish after the page is gone; if it is
  // lost anyway, the server's 3-minute idle limit still ends the tab.
  window.addEventListener('pagehide', () => {
    if (!token) return;
    original('/api/account', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', [TAB_HEADER]: token }, body: JSON.stringify({ action: 'tab-suspend' }) }).catch(() => {});
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && token) window.dispatchEvent(new Event(TAB_RETURNED));
  });
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => {
      if (e.data?.type === 'who' && token && e.data.id === idOf(token)) channel.postMessage({ type: 'mine', id: e.data.id });
    };
  }
}

/** Download a protected file (the tab token can't ride on a plain link). */
export async function downloadFile(id: string, name: string) {
  const r = await fetch('/api/files?id=' + encodeURIComponent(id), { cache: 'no-store' });
  if (!r.ok) {
    if (r.status === 401) window.dispatchEvent(new Event('account-expired'));
    throw Error('Could not download the file. Please retry.');
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
