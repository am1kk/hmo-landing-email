# hmo-landing

The website for Hear Me Out, `hearmeout.social`: the landing page, the invite page behind `/i/<CODE>`, and the legal pages.

| File | What it is |
|---|---|
| `index.html` | Landing page. A self-contained bundler export, not hand-written HTML: the page lives as a JSON string in `<script type="__bundler/template">`. The outer `<head>` (title, link-preview tags) is plain HTML. |
| `404.html` | Invite page and not-found page in one. Its script treats `/i/<CODE>` as an invite and everything else as not found. |
| `privacy.html`, `terms.html`, `legal.css` | Legal pages. |
| `og-preview.jpg` | The link-preview image (1200x630) used by every page. |
| `.well-known/apple-app-site-association` | Universal links for the iOS app (`/i/*`). |
| `worker/index.js` | Cloudflare Worker, runs only for `/i/*` and `/.well-known/*`. |
| `wrangler.jsonc`, `package.json` | Cloudflare config, build and deploy scripts. |

## Hosting

The site runs on Cloudflare: static files are served by the Workers assets binding, and the Worker handles two path families.

- `/i/<CODE>` answers **200** with the invite page and writes that invite's title and description into the link-preview tags (from the Supabase RPC `get_invite_preview`, cached 5 min), in the request's language (see [Languages](#languages)). Without the Worker the page would be served with status 404, and Telegram builds no preview from a 404. The preview image is the same static `og-preview.jpg` for every invite.
- `/.well-known/apple-app-site-association` is re-served as `application/json` (the file has no extension).

Every other unknown path gets `404.html` with status 404.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` runs `wrangler deploy` with the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; it takes about 20 seconds.

By hand: `npx wrangler login` once, then `npm run deploy`.

## Working locally

```
npm install
npm run dev        # http://localhost:8787
```

No invite code resolves right now: `D7PDR9`, the old test code, returns `null` from `get_invite_preview` (checked 2026-11-20), so every code shows the generic invite, like the unknown-code path `/i/ZZZZZZ`. Pick the language with a header (`curl -H 'Accept-Language: fr' localhost:8787/i/ZZZZZZ`), or in a Chrome with its own profile (`open -na "Google Chrome" --args --user-data-dir=/tmp/hmo-fr --accept-lang=fr`).

To see a personal invite, run a stand-in for the RPC on another port and point `SUPABASE_URL` in `worker/index.js` and `404.html` at it; don't commit that. It answers `POST /rest/v1/rpc/get_invite_preview` with `null` or a preview object (`inviter_username`, `group_name`, `question`, and `inviter_avatar_url` as `avatars/<path>.jpg`, served under `/storage/v1/object/public/`), with CORS headers for the page's own request (`Access-Control-Allow-Origin: *`; allow `apikey, authorization, content-type` on `OPTIONS`). The Worker caches each code's answer, 60 s for an unknown code and 5 min for a valid one, so use a new code after changing an answer.

**Revert both `SUPABASE_URL` edits before committing: merging to `main` deploys.** `grep -nE 'localhost|127\.0\.0\.1' worker/index.js 404.html` must print nothing.

`wrangler dev` and `wrangler deploy` first run `npm run build`, which copies the site files into `dist/` (git-ignored). **The copy is an explicit list in `package.json`: a new static file is not served by Cloudflare until it is added there.** Restart `npm run dev` after editing a page; only `worker/` is watched.

## Link previews

All preview tags are static HTML in the `<head>` of `index.html` and `404.html`; crawlers don't run JavaScript. On `/i/<CODE>` the Worker overrides title and description: the invite's own for a valid code, the generic card in the request's language otherwise.

Messengers cache previews hard, including a failed image fetch, keyed by URL. When the image changes, bump the version in the tags (`og-preview.jpg?v=2` → `?v=3`) or rename the file. To re-test a link a messenger has already seen, add a throwaway query (`/i/<CODE>?x=1`), or send the link to `@WebpageBot` in Telegram.

## Languages

The invite page and its link preview come in the app's four languages: English, Brazilian Portuguese (`pt-BR`), Latin American Spanish (`es-419`) and French (`fr`).

- **The rule.** The Worker picks one language per `/i/<CODE>` response from `Accept-Language`: the first tag, highest `q` first (`q=0` skipped), whose primary subtag is `pt`, `es`, `fr` or `en`. So `pt-PT` gets `pt-BR`, every Spanish `es-419`, every French `fr`; anything else, or no header, gets English. The mapping by primary subtag is the same as the app's `AppLanguage.swift`, but the result can differ: on a `pt-PT` phone that also lists English, iOS shows English and the Worker gives `pt-BR`. The Worker writes it into `<html lang>` and `Content-Language` (with `Vary: Accept-Language`) and translates the preview tags and the footer links; the page's script reads `<html lang>` and translates the invite before showing it.
- **Why the visitor's language.**
  - The visitor is the reader. The app they install opens in that same device language, and the app itself follows each reader's own language (pushes, questions), never the sender's.
  - The inviter's language isn't stored per invite: `device_tokens.language` is per device, and null for app builds ≤ 1.9.
  - A preview card is built once and shown to both sides, so it can never follow the recipient. iMessage and WhatsApp fetch it on the sender's phone, so it comes out in the inviter's language. Server-side fetchers come out in English: Telegram sends `en-US`, Slack sends no `Accept-Language`, and Instagram, Messenger, Snapchat, Discord and X are unverified but presumed English.
  - Inviter-language previews everywhere would need the app to add `?l=<lang>` to the share link (both `shareURL(for:)` and the copy pill in hmo-ios), with the Worker using it for the preview tags only and keeping `<html lang>` as the visitor's language. Not built.
- **Today's question stays English**, on the page and in the preview: `get_invite_preview` returns it in English only, so `#question` carries `lang="en"` for screen readers. The translations already exist (`take_pool_translations`, hmo-ios `supabase/migrations/20261120120000_prompt_translations.sql:86`, via `private.prompt_language`); what's missing is an hmo-ios follow-up that replaces the RPC: drop `get_invite_preview(text)` and create `get_invite_preview(p_code text, p_language text default null)`, as hmo-ios `supabase/migrations/20261120120200_push_language.sql` did for `register_push_token`. Once that ships, the web needs `p_language: lang` in both RPC calls (`worker/index.js` and `404.html`), the language in the Worker's cache key (`/__invite-preview/<CODE>/<lang>`), and the `lang="en"` dropped from `#question`. Not before: PostgREST fails the call on an unknown argument.
- **Not translated:** today's question (above), `og-preview.jpg` and its alt text, the not-found page (no Worker rewrite), the "Turn on JavaScript" block (served by the Worker on `/i/<CODE>`, but its text isn't translated), the landing page and the legal pages.
- **Where the strings live:** `COPY` in `worker/index.js` (preview tags, footer) and `COPY` in `404.html` (the invite page). The keys both have (`friend`, `invitedYouTo`, `titleGroup`, `question`, `waiting`) must match. Wording follows the app's glossary, hmo-ios `app_docs/localization-glossary.md`.
- **Adding a language:** add its primary subtag to `LANGUAGES` in `worker/index.js`, an entry under its id (e.g. `de`) to both `COPY` tables, and a line here. Check that the green button still fits on one line at 360 px.

## Analytics

The invite page (`/i/<CODE>` in `404.html`) sends named events to Mixpanel, the same project as the iOS app, loaded with Mixpanel's async snippet from `cdn.mxpnl.com`. The not-found page sends nothing. The project token sits in `404.html` next to the Supabase key; it is public by design (it can only write events). Naming follows the app's tracking plan (`AnalyticsEvent.swift` in hmo-ios). Every event carries `invite_code`, plus the super properties `platform: "web"` and `build_environment` (`release` on `hearmeout.social` and `www.hearmeout.social`, `debug` everywhere else, including `*.workers.dev` and previews). No page-view tracking, no autocapture, no PII.

| Event | When |
|---|---|
| `invite_page_viewed` | An invite path opens, before the preview fetch. |
| `invite_preview_loaded` | The preview fetch finished; `result`: `valid`, `unknown` (no such code) or `failed` (error or timeout). |
| `invite_get_app_tapped` | "Get the app & unlock" tapped. |
| `invite_open_app_tapped` | "Open your invite" tapped (tries `hmo://`). |
| `invite_store_fallback_redirected` | The app didn't open, so the page sent the user to the App Store. |
| `invite_code_copied` | "Copy code" succeeded. |

If an ad blocker stops the Mixpanel script, the page works as before and no events are sent.

These are web-only events. Accepting an invite happens in the app (`onboarding_invite_code_accepted`, `onboarding_invite_join_tapped`), and those events carry no `invite_code` and a different `distinct_id`, so Mixpanel shows a web funnel (viewed → preview `valid` → open/get-app tapped, per `invite_code`) and a separate app funnel that can't be joined. And since `/i/*` is a universal link, people who already have the app usually skip this page: web counts mostly cover visitors without the app.

## DNS and email

DNS for `hearmeout.social` lives in the Cloudflare zone (registrar: Namecheap). The domain also carries Namecheap Private Email: the `MX`, SPF and DKIM `TXT`, `mail` / `autodiscover` / `autoconfig` CNAME and `_autodiscover._tcp` SRV records must stay, and must stay **DNS only** (grey cloud).
