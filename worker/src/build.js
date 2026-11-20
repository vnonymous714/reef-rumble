/* One build id for the Worker, the Telegram Play buttons and the client
   self-check (index.html RR_BUILD). Bump together with the Pages ?v= markers.
   (Own module: a Worker entry may only export handlers/functions.) */
export const CLIENT_BUILD = 'tg38';
export function miniAppUrl(env) {
  if (!env.MINIAPP_URL) return null;
  const u = new URL(env.MINIAPP_URL);
  u.searchParams.set('v', CLIENT_BUILD); // Telegram WebView caches by URL
  return u.toString();
}
