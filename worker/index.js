// hearmeout.social edge Worker. Static files are served by the assets binding;
// the Worker only runs for /i/* and /.well-known/* (wrangler.jsonc,
// run_worker_first).
//
//   /i/<CODE>  The invite page is 404.html, which the asset server returns
//              with status 404 for unknown paths. Messenger crawlers don't
//              build a link preview from a 404 and don't run the page's JS, so
//              answer 200 and write the per-invite title/description into the
//              head. The preview image stays the static og-preview.jpg.
//   /.well-known/apple-app-site-association
//              Has no file extension, so the asset server can't infer JSON.

// Same Supabase project + publishable (anon) key that 404.html ships with.
const SUPABASE_URL = 'https://oxownhqtqwqdjvhqecoz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Jsk5aLowVIYNmAzlORaqOA_m2No2UHO';
const PREVIEW_TIMEOUT_MS = 3000;
const PREVIEW_TTL_S = 300;
const UNKNOWN_CODE_TTL_S = 60;

// Keep in sync with the matcher in 404.html.
const INVITE_PATH = /^\/i\/([A-Za-z2-9]{6})\/?$/;
const AASA_PATH = '/.well-known/apple-app-site-association';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === AASA_PATH) return serveAASA(request, env);

    const match = INVITE_PATH.exec(url.pathname);
    if (match) return serveInvite(request, env, ctx, url, match[1].toUpperCase());

    return env.ASSETS.fetch(request);
  },
};

async function serveAASA(request, env) {
  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok) return asset;
  const headers = new Headers(asset.headers);
  headers.set('Content-Type', 'application/json');
  return new Response(asset.body, { status: 200, headers });
}

async function serveInvite(request, env, ctx, url, code) {
  // No asset lives at /i/<CODE>, so this is 404.html (status 404).
  const [page, preview] = await Promise.all([
    env.ASSETS.fetch(new Request(url, { method: 'GET' })),
    loadPreview(url, code, ctx).catch(() => null),
  ]);

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
  });
  const response = new Response(page.body, { status: 200, headers });

  // RPC failed or the code is unknown: the static card already in the page.
  if (!preview || typeof preview !== 'object') return response;

  const username = cleanText(preview.inviter_username, 40).replace(/^@+/, '');
  const groupName = cleanText(preview.group_name, 80);
  const question = cleanText(preview.question, 200);

  const title = (username ? '@' + username : 'A friend') + ' invited you to ' +
    (groupName || 'Hear Me Out');
  const description = (question ? 'Today’s question: ' + question + ' — your' : 'Your') +
    ' friends’ answers are already waiting. 👀';
  const canonical = url.origin + '/i/' + code;

  // setAttribute / setInnerContent / append escape their text themselves.
  const setContent = (value) => ({
    element(el) { el.setAttribute('content', value); },
  });
  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(title + ' — Hear Me Out'); } })
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[name="twitter:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(description))
    .on('meta[name="twitter:description"]', setContent(description))
    .on('meta[property="og:type"]', {
      element(el) {
        el.after('\n<meta property="og:url" content="' + canonical + '">', { html: true });
      },
    })
    .transform(response);
}

// Several crawlers hit the same link within seconds of a share, so keep the
// RPC result at the edge for a few minutes.
async function loadPreview(url, code, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/__invite-preview/' + code);
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/get_invite_preview', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_code: code }),
    signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('preview HTTP ' + response.status);
  const preview = await response.json();

  const ttl = preview === null ? UNKNOWN_CODE_TTL_S : PREVIEW_TTL_S;
  ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(preview), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=' + ttl,
    },
  })));
  return preview;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
