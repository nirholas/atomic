/**
 * Shared by the tools that print the RPC endpoint they use. Providers put the
 * API key in the query (`?api-key=`), the path (`/v2/<key>`, `/<token>/`) or
 * userinfo, so only the scheme and host are shown.
 */
export function redactRpcUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '<unparseable RPC URL>';
  }
  const hidden = url.username !== '' || url.password !== '' || url.search !== '' || (url.pathname !== '/' && url.pathname !== '');
  return `${url.protocol}//${url.host}${hidden ? '/…' : ''}`;
}
