// hearmeout.social edge Worker. Static files are served by the assets binding;
// the Worker only runs for /i/* and /.well-known/* (wrangler.jsonc,
// run_worker_first).
//
//   /i/<CODE>  The invite page is 404.html, which the asset server returns
//              with status 404 for unknown paths. Messenger crawlers don't
//              build a link preview from a 404 and don't run the page's JS, so
//              answer 200 and write the per-invite title/description into the
//              head, in the language picked from Accept-Language (also written
//              into <html lang>, which the page's JS translates the invite
//              into). The preview image stays the static og-preview.jpg.
//   /.well-known/apple-app-site-association
//              Has no file extension, so the asset server can't infer JSON.

// Same Supabase project + publishable (anon) key that 404.html ships with.
const SUPABASE_URL = 'https://oxownhqtqwqdjvhqecoz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Jsk5aLowVIYNmAzlORaqOA_m2No2UHO';
const SITE_ORIGIN = 'https://hearmeout.social';
const PREVIEW_TIMEOUT_MS = 3000;
const PREVIEW_TTL_S = 300;
const UNKNOWN_CODE_TTL_S = 60;

// Keep in sync with the matcher in 404.html.
const INVITE_PATH = /^\/i\/([A-Za-z2-9]{6})\/?$/;
const AASA_PATH = '/.well-known/apple-app-site-association';

// The app's four languages, by primary subtag (hmo-ios AppLanguage.swift):
// pt-PT reads pt-BR, every Spanish es-419, every French fr.
const LANGUAGES = new Map([['pt', 'pt-BR'], ['es', 'es-419'], ['fr', 'fr'], ['en', 'en']]);

// Link-preview copy and the footer links. Keep in sync with COPY in 404.html
// (same keys and wording); the English card* strings are the static tags in
// its <head>. The footer is translated here, not by the page's JS, because it
// is visible before that script runs.
const COPY = {
  en: {
    friend: 'A friend',
    invitedYouTo: 'invited you to',
    titleGroup: 'Hear Me Out',
    question: 'Today’s question:',
    waiting: 'Your friends’ answers are already waiting. 👀',
    cardTitle: 'You’re invited to Hear Me Out',
    cardDescription: 'Your friends’ answers to today’s question are already waiting. Get the app and unlock them. 👀',
    privacy: 'Privacy',
    terms: 'Terms',
  },
  'pt-BR': {
    friend: 'Um amigo',
    invitedYouTo: 'te convidou pro grupo',
    titleGroup: 'da galera',
    question: 'Pergunta de hoje:',
    waiting: 'As respostas dos seus amigos já estão te esperando. 👀',
    cardTitle: 'Chegou seu convite pro Hear Me Out',
    cardDescription: 'As respostas dos seus amigos pra pergunta de hoje já estão te esperando. Baixa o app pra liberar. 👀',
    privacy: 'Privacidade',
    terms: 'Termos',
  },
  'es-419': {
    friend: 'Un amigo',
    invitedYouTo: 'te invitó a',
    titleGroup: 'su grupo',
    question: 'Pregunta de hoy:',
    waiting: 'Las respuestas de tus amigos ya te están esperando. 👀',
    cardTitle: 'Te invitaron a Hear Me Out',
    cardDescription: 'Las respuestas de tus amigos a la pregunta de hoy ya te están esperando. Descarga la app para desbloquearlas. 👀',
    privacy: 'Privacidad',
    terms: 'Términos',
  },
  fr: {
    friend: 'Un ami',
    invitedYouTo: 't’invite dans',
    titleGroup: 'son groupe',
    question: 'Question du jour\u00a0:',
    waiting: 'Les réponses de tes amis t’attendent déjà. 👀',
    cardTitle: 'On t’invite sur Hear Me Out',
    cardDescription: 'Les réponses de tes amis à la question du jour t’attendent déjà. Télécharge l’app pour les débloquer. 👀',
    privacy: 'Confidentialité',
    terms: 'Conditions',
  },
};

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
  const lang = pickLanguage(request.headers.get('Accept-Language'));
  const copy = COPY[lang];

  // No asset lives at /i/<CODE>, so this is 404.html (status 404).
  const [page, preview] = await Promise.all([
    env.ASSETS.fetch(new Request(url, { method: 'GET' })),
    loadPreview(url, code, ctx).catch(() => null),
  ]);

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    'Content-Language': lang,
    'Vary': 'Accept-Language',
  });
  const response = new Response(page.body, { status: 200, headers });

  // setAttribute / setInnerContent / append escape their text themselves.
  const setContent = (value) => ({
    element(el) { el.setAttribute('content', value); },
  });
  const setText = (value) => ({
    element(el) { el.setInnerContent(value); },
  });

  const rewriter = new HTMLRewriter()
    .on('html', { element(el) { el.setAttribute('lang', lang); } })
    .on('footer a[href="/privacy.html"]', setText(copy.privacy))
    .on('footer a[href="/terms.html"]', setText(copy.terms))
    // The page's image tags are absolute URLs on the production origin. Serve
    // the image from whatever origin answered (workers.dev before the domain
    // move), so the card never depends on another host. No-op in production.
    .on(
      'meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]',
      {
        element(el) {
          const src = el.getAttribute('content') || '';
          if (src.startsWith(SITE_ORIGIN + '/')) {
            el.setAttribute('content', url.origin + src.slice(SITE_ORIGIN.length));
          }
        },
      });

  // RPC failed or the code is unknown: the generic card.
  let title = copy.cardTitle;
  let description = copy.cardDescription;

  if (preview && typeof preview === 'object') {
    const username = cleanText(preview.inviter_username, 40).replace(/^@+/, '');
    const groupName = cleanText(preview.group_name, 80);
    const question = cleanText(preview.question, 200);

    title = (username ? '@' + username : copy.friend) + ' ' + copy.invitedYouTo + ' ' +
      (groupName || copy.titleGroup);
    // After the question, `waiting` continues the sentence: lower-case its first letter.
    description = question
      ? copy.question + ' ' + question + ' — ' + copy.waiting[0].toLowerCase() + copy.waiting.slice(1)
      : copy.waiting;
    const canonical = url.origin + '/i/' + code;

    rewriter
      .on('title', setText(title + ' — Hear Me Out'))
      .on('meta[property="og:type"]', {
        element(el) {
          el.after('\n<meta property="og:url" content="' + canonical + '">', { html: true });
        },
      });
  }

  return rewriter
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[name="twitter:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(description))
    .on('meta[name="twitter:description"]', setContent(description))
    .transform(response);
}

// The first supported language in Accept-Language, highest q first (a stable
// sort keeps the header's order on ties; q=0 means "not this one"), else English.
function pickLanguage(header) {
  const ranked = (header || '').split(',')
    .map((part) => {
      const [tag, ...params] = part.split(';');
      const q = params.find((param) => /^\s*q=/i.test(param));
      return {
        lang: LANGUAGES.get(tag.trim().toLowerCase().split(/[-_]/)[0]),
        q: q ? Number(q.split('=')[1]) : 1,
      };
    })
    .filter((entry) => entry.lang && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked.length ? ranked[0].lang : 'en';
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
