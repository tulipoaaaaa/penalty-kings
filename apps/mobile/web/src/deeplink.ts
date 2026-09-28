/**
 * Deep-link return for OAuth redirects in the native app (docs/WALLETS.md, "Native app: deep-link return").
 * A login provider (Google via Privy, later the founders' SDK) redirects to  com.penaltykings.test://auth?…  ;
 * Android (intent filter) and iOS (URL type) hand that URL to the app (@capacitor/app "appUrlOpen"), and the shell
 * reloads itself with ONLY the known OAuth return parameters, which the wallet provider's restore() reads.
 */
export const APP_SCHEME = "com.penaltykings.test";
export const AUTH_RETURN_URL = `${APP_SCHEME}://auth`;
const ALLOWED = ["privy_oauth_code", "privy_oauth_state", "privy_oauth_provider"] as const;

/** "?privy_oauth_code=…&privy_oauth_state=…" for a valid auth return URL, else null (any other URL is ignored). */
export function authReturnSearch(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== "auth") return null;
  const out = new URLSearchParams();
  for (const key of ALLOWED) {
    const value = parsed.searchParams.get(key);
    if (value !== null && value.length <= 2048) out.set(key, value);
  }
  return out.has("privy_oauth_code") && out.has("privy_oauth_state") ? `?${out.toString()}` : null;
}
