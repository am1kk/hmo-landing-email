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

- `/i/<CODE>` answers **200** with the invite page and writes that invite's title and description into the link-preview tags (from the Supabase RPC `get_invite_preview`, cached 5 min). Without the Worker the page would be served with status 404, and Telegram builds no preview from a 404. The preview image is the same static `og-preview.jpg` for every invite.
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

`/i/D7PDR9` is a real invite code for testing; `/i/ZZZZZZ` exercises the unknown-code path.

`wrangler dev` and `wrangler deploy` first run `npm run build`, which copies the site files into `dist/` (git-ignored). **The copy is an explicit list in `package.json`: a new static file is not served by Cloudflare until it is added there.** Restart `npm run dev` after editing a page; only `worker/` is watched.

## Link previews

All preview tags are static HTML in the `<head>` of `index.html` and `404.html`; crawlers don't run JavaScript. The Worker only overrides title and description for a valid invite.

Messengers cache previews hard, including a failed image fetch, keyed by URL. When the image changes, bump the version in the tags (`og-preview.jpg?v=2` → `?v=3`) or rename the file. To re-test a link a messenger has already seen, add a throwaway query (`/i/D7PDR9?x=1`), or send the link to `@WebpageBot` in Telegram.

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
