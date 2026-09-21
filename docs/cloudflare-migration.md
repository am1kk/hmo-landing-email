# Move hearmeout.social to Cloudflare Workers (dynamic invite previews)

## Status (2026-09-21)

Steps 1, 2 and 6 are implemented in the repo and verified locally with `wrangler dev`. Still open: step 4 (first deploy to workers.dev), step 5 (domain move), and the two GitHub secrets for step 6.

How the implementation differs from the plan below:

- **Preview image is static.** Step 3 (per-code `og.png`) is dropped: every invite uses `og-preview.jpg`, which replaced `og-invite.jpg`. The Worker rewrites only the title/description tags and adds `og:url`.
- **Assets come from `dist/`, not the repo root.** With `directory: "./"`, `wrangler dev` reloads forever (`.wrangler/` sits inside the watched folder), and a deny-list `.assetsignore` is easy to get wrong. `npm run build` copies an explicit list of site files into `dist/`; `wrangler dev` / `wrangler deploy` run it automatically. A new static file has to be added to that list in `package.json`. Once GitHub Pages is retired the files can simply move into a `public/` folder.
- **Head tags are rewritten with `HTMLRewriter`** (escapes values itself) instead of string replacement, and the page body comes from `ASSETS.fetch('/i/<CODE>')`, which is the 404 page, because `/404.html` itself redirects to `/404` under the default `html_handling`.
- Same default means `/privacy.html` and `/terms.html` answer 307 to `/privacy` and `/terms`. Existing links keep working.

## Context

The invite page (`404.html`, served for `/i/<CODE>`) is live on GitHub Pages and personalises itself client-side from the Supabase RPC `get_invite_preview`. Two things GitHub Pages cannot do:

1. **Per-code link previews.** Messenger crawlers don't run JS, so every shared invite shows the same generic Open Graph card.
2. **HTTP 200 for `/i/<CODE>`.** Pages returns 404 for those paths; some crawlers refuse to build a card from a 404 response.

Cloudflare fixes both: static assets served from the edge, plus a tiny Worker on `/i/*` that returns 200 and injects per-code OG tags (and optionally renders a per-code preview image). The Cloudflare account and Wrangler login already exist on this machine (used by `~/Documents/Projects/lonely-labs-landing`, `wrangler.jsonc`, Wrangler 4.119). DNS for hearmeout.social is at Namecheap pointing at GitHub Pages, so the domain move is the one step with waiting in it.

After approval, this plan gets copied into the repo as `docs/cloudflare-migration.md` so it's there tomorrow.

## Outcome

- `hearmeout.social` served by Cloudflare; GitHub Pages retired.
- `/i/<CODE>` returns 200 with `og:title` = "@user invited you to <group>", `og:description` = today's question, `og:image` = per-code card. Everything else on the page unchanged.
- Universal links (`/.well-known/apple-app-site-association`) keep working.
- Push to `main` deploys automatically.

## Steps

### 1. Wrangler config + static assets (repo: hmo-landing)

- `package.json` (new): devDependency `wrangler@^4.119`, scripts `dev` (`wrangler dev`), `deploy` (`wrangler deploy`). Add `node_modules/` to `.gitignore`.
- `wrangler.jsonc` (new), modelled on lonely-labs-landing's:
  - `name: "hmo-landing"`, `main: "worker/index.js"`, `compatibility_date` = today
  - `assets: { directory: "./", binding: "ASSETS", not_found_handling: "404-page", run_worker_first: ["/i/*", "/.well-known/*"] }`
  - `observability.enabled: true`
  - No `routes` yet; deploy to workers.dev first. Custom domain added in step 5.
- `.assetsignore` (new): `.git`, `node_modules`, `worker`, `docs`, `.claude`, `CNAME`, `.nojekyll`, `.DS_Store`, `package*.json`, `wrangler.jsonc`, `.assetsignore`.
- `not_found_handling: "404-page"` serves `/404.html` with status 404 for unknown paths, which is exactly the GH Pages behaviour the existing not-found branch of the page expects.

### 2. Worker: `worker/index.js`

Plain JS, no bundler, no framework. Handles two path families; everything else is `env.ASSETS.fetch(request)`.

**`/.well-known/apple-app-site-association`** — fetch from ASSETS, re-serve with `Content-Type: application/json` (the file has no extension, so the asset server can't infer it).

**`/i/<CODE>`** (same regex as the page: `^/i/([A-Za-z2-9]{6})/?$`):
1. Call `POST https://oxownhqtqwqdjvhqecoz.supabase.co/rest/v1/rpc/get_invite_preview` with the publishable key (already public in `404.html`), `{ p_code }`, 3 s timeout via `AbortSignal.timeout`. Cache the JSON in the Cache API for ~5 min keyed by code (previews are hit repeatedly by multiple crawlers per share).
2. Fetch `/404.html` from ASSETS as text.
3. If the preview resolved: replace the static `og:title`, `og:description`, `twitter:title`, `twitter:description`, `<title>` values, add `og:url`, and point `og:image` / `twitter:image` at `/i/<CODE>/og.png` (step 3). Values are HTML-escaped (`& < > "`) before insertion. Truncate group name to 80 chars, question to 200. Copy: title `@user invited you to <group>`, description `Today's question: <question> — your friends' answers are already waiting. 👀` (fallback without the question part when null).
4. If the RPC fails or returns null: serve the page untouched, with the static card.
5. Respond **200**, `Content-Type: text/html; charset=utf-8`, `Cache-Control: public, max-age=60`. Non-matching `/i/...` paths → ASSETS (which yields the 404 page).

The page's own JS keeps doing the client-side personalisation exactly as today, so nothing in `404.html`'s script changes. Only the head tags get rewritten server-side.

### 3. Per-code preview image: `/i/<CODE>/og.png`

- Dependency `workers-og` (Satori + resvg in wasm, built for Workers). Requires `nodejs_compat` flag in `wrangler.jsonc`.
- Fonts: decode the Special Gothic Expanded One TTF that is already base64-embedded in `404.html` into `worker/fonts/SpecialGothicExpandedOne.ttf`, plus an Inter Tight TTF for body text; load them as Worker module imports (`rules: [{ type: "Data", globs: ["**/*.ttf"] }]`).
- Layout mirrors the page and the existing `og-invite.jpg`: wordmark top-left, "@user invited you to" white, group name yellow (`#FFCF31`), "Today's question:" label, the question in yellow display type, green "Get the app & unlock" pill. Avatar can be included by fetching the public storage URL and inlining it as a data URL (skip on failure).
- Cyrillic / emoji: the display font has no Cyrillic, so pass a fallback font (Inter Tight covers it); Satori needs emoji as images, so strip emoji from the group name in the image (keep it in the OG text tags).
- Cache the PNG in the Cache API for 10 min keyed by code. Fallback to the static `og-invite.jpg` (redirect) on any render error.
- This step is independent of step 2 and can be skipped for the first deploy; step 2 then keeps `og:image` on the static card.

### 4. Deploy to workers.dev and verify

- `npx wrangler deploy` → `https://hmo-landing.<account>.workers.dev`.
- Checks (curl): `/` 200 landing, `/privacy.html` 200, `/i/D7PDR9` 200 with injected tags, `/i/ZZZZZZ` 200 with static tags, `/i/foo` 404 page, `/nope` 404 page, `/.well-known/apple-app-site-association` 200 `application/json`, `/i/D7PDR9/og.png` 200 `image/png`.
- Paste the workers.dev invite link into iMessage/Telegram/WhatsApp to confirm the card renders per code (crawler behaviour can't be tested with curl).

### 5. Domain move (Namecheap → Cloudflare)

- Cloudflare dashboard: add site `hearmeout.social` (Free plan). Review the imported records; keep anything that isn't the GitHub Pages A/CNAME set (MX etc., if any).
- Namecheap: switch nameservers to the two Cloudflare gives. Propagation: minutes to 24 h. GitHub Pages keeps serving until it lands, so no downtime.
- Once the zone is active: `wrangler.jsonc` → `routes: [{ pattern: "hearmeout.social", custom_domain: true }, { pattern: "www.hearmeout.social", custom_domain: true }]`, redeploy. Cloudflare issues the certificate automatically.
- Re-run the step 4 checks against `https://hearmeout.social`, then delete the GitHub Pages site and the `CNAME` file.
- Apple caches the AASA via its CDN; verify with `curl https://app-site-association.cdn-apple.com/a/v1/hearmeout.social` after the move and by tapping a real invite link on a device with the app installed.

### 6. Auto-deploy on push

- `.github/workflows/deploy.yml`: on push to `main`, `actions/checkout`, `cloudflare/wrangler-action@v3` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets (token scope: Workers Scripts Edit + Account Settings Read).
- Create the token in the Cloudflare dashboard and add both secrets to the GitHub repo (`gh secret set`).

## Files touched

New: `package.json`, `wrangler.jsonc`, `.assetsignore`, `worker/index.js`, `worker/fonts/*.ttf`, `.github/workflows/deploy.yml`, `docs/cloudflare-migration.md` (this plan).
Modified: `.gitignore`. Removed at the end of step 5: `CNAME`, `.nojekyll`.
Unchanged: `404.html`, `index.html`, legal pages, `og-invite.jpg` (stays as the fallback card), `.well-known/apple-app-site-association`.

## Verification

1. Local: `npx wrangler dev`, then the curl checklist from step 4 against `http://localhost:8787`, plus the existing headless-Chrome screenshot flow for `/i/D7PDR9` to confirm the page itself is byte-identical apart from head tags.
2. workers.dev: same checklist over HTTPS, plus a real messenger paste test.
3. After DNS: checklist against the real domain, universal link tap test on a phone with the app, and an App Store redirect test on a phone without it.

## Time

Steps 1–2 and 4: about 1.5 h. Step 3: about 1 h. Step 6: 15 min. Step 5: 20 min of work plus DNS propagation.
