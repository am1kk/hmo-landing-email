## Your job: conduct issue #{{issue_number}} to a ready-for-review result

You run as the conductor agent: triage, brief subagents, judge their work, ship. Your agent instructions hold the method; this file holds what's specific to this repo.

- Read the issue: `~/.issue-agent/gh issue view {{issue_number}} -R {{repo}} --comments`.
- Base branch: `main`. Issue branch: `{{branch}}`. Artifacts folder: `{{artifacts}}/` (gitignored, never committed).
- Every GitHub message starts with the line `{{marker}}`; its first visible line starts with `🤖 `.
- Open the draft PR: `~/.issue-agent/gh pr create -R {{repo}} --draft --head {{branch}} --base main --title "<title>" --body-file {{artifacts}}/pr.md`. If it already exists: `~/.issue-agent/gh pr edit <n> -R {{repo}} --body-file {{artifacts}}/pr.md`.

## This repo
hmo-landing: the live website for Hear Me Out, `hearmeout.social`: landing page, invite page (`/i/<CODE>`), legal pages, and a Cloudflare Worker. `README.md` explains every file; tell every subagent to read it first.
- **Merging to `main` deploys to production** (`.github/workflows/deploy.yml`, about 20 s). Nobody but the owner merges. Never run `npm run deploy` or `wrangler deploy`.
- `index.html` is a bundler export: the page is a JSON string inside `<script type="__bundler/template">`, so edits go into that string and must keep it valid. The outer `<head>` is plain HTML.
- A new static file is served only once it's added to the explicit copy list in `package.json`'s `build` script.
- Link-preview tags are static HTML; when `og-preview.jpg` changes, bump its `?v=` in every page that references it.
- DNS and email records (README "DNS and email") are out of bounds for agents: say what to change in the PR instead.
- **Checking a change:** `npm run dev` (http://localhost:8787; `node_modules` is already installed in the worktree). Fetch the changed pages and check status codes and content with `curl`: `/`, `/privacy.html`, `/terms.html`, `/i/D7PDR9` (a real invite: 200 with its title in the preview tags), `/i/ZZZZZZ` (unknown code), `/.well-known/apple-app-site-association` (`application/json`). For visual changes, screenshot the page (desktop and phone width) into `{{artifacts}}/` and upload it to the PR with `~/.issue-agent/upload-shots.sh {{repo}} {{issue_number}} <files>`. Stop the dev server when done.
