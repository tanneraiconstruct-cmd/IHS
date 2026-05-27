# Cloudflare Deploy — Design Spec

**Date:** 2026-05-26
**Status:** Approved — ready for implementation plan
**Supersedes:** Vercel hosting references in `docs/SCHEDULING-TOOL-PLAN.md` and `docs/superpowers/plans/2026-05-21-nextjs-project-scaffold.md` (Task 8)

---

## Goal

Move the IHS Scheduling Tool from "never deployed" to running on Cloudflare Workers via `@opennextjs/cloudflare`, with GitHub-connected auto-deploys (Workers Builds), a personal `cloudflared` tunnel installed for ad-hoc dev sharing, and all Vercel references scrubbed from the repo. Strictly Cloudflare from here on out.

## Non-Goals (YAGNI guardrails)

- R2 incremental cache, KV tag cache, D1 — nothing today needs them
- Custom domain (workers.dev for v1)
- Workers Logs export pipeline (built-in observability only, no Logpush)
- Per-route `export const runtime = 'edge'` conversion (OpenNext + `nodejs_compat` handles everything)
- Image optimization config (`sharp` not installed; no `next/image` perf work yet)
- A second `cloudflared` tunnel for a private origin (architecture-ready, not provisioned)

---

## Architecture

**The Worker = the entire Next 16 app.** `@opennextjs/cloudflare` packages a `next build` output into a single Worker entrypoint (`.open-next/worker.js`) plus a static asset directory (`.open-next/assets`) served by the Workers Assets binding. Everything runs under the Workers runtime with the `nodejs_compat` compatibility flag, so existing Node-style code (`@supabase/ssr`, `cookies()` from `next/headers`, server actions) keeps working unchanged.

| Concern | Where it lives | Notes |
|---|---|---|
| Hosting | Cloudflare Workers (auto-routed) | Single Worker, no per-route runtime exports |
| DB / Auth / Realtime / Storage | Supabase (`uluasgpcokjwowpawavl`) | Unchanged |
| Local dev | `next dev` | Unchanged DX |
| Real-runtime preview | `npm run preview` → `wrangler dev` | Optional; for testing Workers-specific behavior locally |
| E2E (Playwright) | Local `next dev` | Unchanged |
| Tunnel | `cloudflared` on Mac | Independent of the Worker; for dev sharing |

**Compatibility notes (verified):**
- `@supabase/ssr` cookie helper works on Workers under OpenNext (OpenNext shims Next's request context).
- Realtime is client-side WebSocket — not affected by server runtime.
- Zustand / React Query / Zod — pure JS, no Node-only APIs.
- No `sharp` in deps → no image-optimization compat issue.

---

## Build, Deploy & Environment

### New files at repo root

**`wrangler.jsonc`** — source of truth for Worker config:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "ihs-scheduling-tool",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "observability": { "enabled": true }
}
```

**`open-next.config.ts`** — minimal, no R2 cache (per non-goals):

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
export default defineCloudflareConfig({});
```

### New dev dependencies

- `@opennextjs/cloudflare@latest`
- `wrangler@latest` (≥ 3.99.0 required by OpenNext)

### `package.json` script changes

| Script | Action | Value |
|---|---|---|
| `dev` | unchanged | `next dev` |
| `build` | unchanged | `next build` |
| `start` | **removed** | (`next start` is meaningless on Workers; would be a footgun) |
| `preview` | added | `opennextjs-cloudflare build && opennextjs-cloudflare preview` |
| `deploy` | added | `opennextjs-cloudflare build && opennextjs-cloudflare deploy` |
| `cf-typegen` | added | `wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts` |

### `.gitignore` changes

- **Remove:** lines 38–39 (`# vercel` block + `.vercel`)
- **Add:** `.open-next/`, `.wrangler/`, `cloudflare-env.d.ts`

### CI = Workers Builds (Cloudflare-native, GitHub-connected)

**One-time setup in the Cloudflare dashboard:**
- Workers & Pages → Create → Connect to Git → select `tanneraiconstruct-cmd/IHS`
- Production branch: `main`
- Build command: `npm run deploy`
- Deploy command: (blank — `npm run deploy` already deploys)
- Build variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (plain)
- Runtime secret: `SUPABASE_SERVICE_ROLE_KEY`

**Behavior after wiring:**
- Push to `main` → production deploy at `ihs-scheduling-tool.<account>.workers.dev`
- Open PR → preview Worker on a per-branch URL
- **No `.github/workflows/deploy.yml`** — Workers Builds replaces it. Existing CI for lint/typecheck/test is untouched.

### Environment variables

| Variable | Type | Where it's used |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Plain (build + runtime) | Client bundle needs it at build time |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Plain (build + runtime) | Client bundle needs it at build time |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret (runtime only) | Server actions / route handlers |

Read via `process.env.*` in existing code — no source changes needed (OpenNext shims `process.env` on Workers).

**Local `.env.local`** stays as-is for `next dev`. Optionally add `.dev.vars` (gitignored) if you ever want `npm run preview` to reach Supabase. Not required for v1.

---

## Cloudflare Tunnel

Personal-machine tool, not an app concern. Designed so a future private-origin tunnel is a one-liner without architectural change.

**Install + first-time auth (one-time):**
```bash
brew install cloudflared
cloudflared tunnel login   # opens browser → pick CF account
cloudflared tunnel create ihs-dev   # generates credentials in ~/.cloudflared/
```

**Use it for ad-hoc dev sharing:**
```bash
cloudflared tunnel --url http://localhost:3000 run ihs-dev
```
Prints the public hostname.

**Why a *named* tunnel (vs `cloudflared tunnel --url ...` quick tunnels):** persistent hostname; adding a second tunnel later (e.g. a private Python origin) is just `cloudflared tunnel create <name>` — no rework.

**Documentation:** a short `docs/cloudflare-tunnel.md` with the three commands above and a "to add a private-origin tunnel later" stub. No tunnel config committed (credentials live in `~/.cloudflared/`).

---

## Vercel Scrub

| File | Change |
|---|---|
| `.gitignore` | Delete lines 38–39 (`# vercel` + `.vercel`). Add `.open-next/`, `.wrangler/`, `cloudflare-env.d.ts`. |
| `README.md` | Replace the "Deploy on Vercel" section (lines ~30–34) with a "Deploy on Cloudflare" section pointing at `wrangler.jsonc` and the `npm run deploy` / Workers Builds flow. Leave the "Learn More" Next.js links alone. |
| `docs/SCHEDULING-TOOL-PLAN.md` | Replace 4 Vercel mentions (lines 50, 55, 61, 67, 738) with "Cloudflare Workers (via `@opennextjs/cloudflare`)". Pure search-and-replace. |
| `docs/superpowers/plans/2026-05-21-nextjs-project-scaffold.md` | Add a short "**Superseded — see `docs/superpowers/specs/2026-05-26-cloudflare-deploy-design.md`**" banner at top. Don't rewrite — it's a completed Phase 0 plan, historical. |

`grep -rniE "vercel"` over the repo (excluding `node_modules` and `.next`) returned only those four files. Zero source code changes for the scrub.

---

## Success Criteria

1. `wrangler.jsonc` + `open-next.config.ts` committed at repo root.
2. `package.json` has `preview`, `deploy`, `cf-typegen` scripts; `start` is removed.
3. `npm run preview` boots the app locally on the real Workers runtime and serves the landing page.
4. Pushing to `main` triggers a Workers Builds deploy that ends green; the production URL serves the app and a logged-in scheduler can load the Riverside project.
5. Opening a PR produces a preview Worker URL.
6. `cloudflared tunnel create ihs-dev` succeeds and `cloudflared tunnel --url http://localhost:3000 run ihs-dev` exposes `localhost:3000` at a `*.cfargotunnel.com` hostname.
7. `grep -rniE "vercel"` over the repo (excluding `node_modules`, `.next`, `.open-next`) returns zero matches — except the superseded-banner reference inside the Phase 0 plan.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `@supabase/ssr` cookie behavior differs on Workers vs Node | Validate with `npm run preview` against the Riverside project before flipping `main` deploys; smoke-test login + a write. |
| Workers Builds env-var misconfig produces silent runtime failures | Ordering: (1) validate locally with `npm run preview`; (2) do the first production deploy manually via `npm run deploy` from your laptop to confirm the Worker + bindings work; (3) then connect Workers Builds so subsequent pushes auto-deploy. |
| OpenNext build artifact size pushes past Worker size limits | Workers paid plan ceiling is 10 MB compressed; current app well under. Monitor in dashboard after first deploy. |
| Production deploys via Workers Builds bypass local lint/typecheck/test | Existing GitHub Actions CI for lint/typecheck/test continues to run on PRs; Workers Builds only deploys, not gates. Future hardening: add a status-check requirement. |

---

## Out of Scope (for the implementation plan)

The implementation plan will cover: install deps, write `wrangler.jsonc` + `open-next.config.ts`, update `package.json`, update `.gitignore`, scrub Vercel from docs/README, write `docs/cloudflare-tunnel.md`, and validate `npm run preview` locally. **Manual steps** (CF dashboard wiring, `cloudflared` install + login + tunnel create on your Mac, first production deploy) will be called out explicitly as "you do this, not me" tasks in the plan.
