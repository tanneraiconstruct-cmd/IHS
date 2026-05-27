# Cloudflare Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the IHS Scheduling Tool deployable to Cloudflare Workers via `@opennextjs/cloudflare`, with all Vercel references scrubbed and a `cloudflared` tunnel documented for ad-hoc dev sharing.

**Architecture:** A single Worker hosts the whole Next 16 app. `next build` → OpenNext adapter packages output into `.open-next/worker.js` + `.open-next/assets`. The Workers runtime with `nodejs_compat` runs existing server code unchanged (`@supabase/ssr`, `cookies()`, server actions). Supabase remains the backend. GitHub-connected Workers Builds (configured manually in CF dashboard) replace any prior CI deploy mechanism. The tunnel is a personal-Mac concern, not committed config.

**Tech Stack:** Next.js 16.2.6, React 19, TypeScript 5, `@opennextjs/cloudflare`, Wrangler 4+.

**Spec:** `docs/superpowers/specs/2026-05-26-cloudflare-deploy-design.md`

**Repo context:** Branch `main`, clean working tree. No `.vercel` directory exists; Vercel references are docs-only. Project has never been deployed.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `.gitignore` | modify | Remove Vercel block; add `.open-next/`, `.wrangler/`, `cloudflare-env.d.ts`. |
| `package.json` | modify | Add `@opennextjs/cloudflare` + `wrangler` dev deps; add `preview`, `deploy`, `cf-typegen` scripts; remove `start`. |
| `wrangler.jsonc` | create | Worker config: name, entrypoint, compat flags, assets binding, observability. |
| `open-next.config.ts` | create | Minimal OpenNext config (no R2/KV cache). |
| `README.md` | modify | Replace "Deploy on Vercel" section with "Deploy on Cloudflare". |
| `docs/SCHEDULING-TOOL-PLAN.md` | modify | Replace 5 Vercel mentions with "Cloudflare Workers (via `@opennextjs/cloudflare`)". |
| `docs/superpowers/plans/2026-05-21-nextjs-project-scaffold.md` | modify | Top-of-file superseded banner pointing at this spec. |
| `docs/cloudflare-tunnel.md` | create | Three commands for installing + creating + running the dev tunnel; stub for future private-origin tunnel. |

Each task ends with a commit. Task 5 is a verification-only gate (no commit). Task 8 is user-only manual steps (no commits by the engineer).

---

## Conventions used in this codebase

- **Commit style:** Conventional Commits, scoped — `feat(infra):`, `chore(deps):`, `docs:`, etc. See `git log --oneline -20`.
- **Co-author footer:** every commit ends with
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- **Test commands:**
  - Unit (`vitest`): `npm test`
  - E2E (`playwright`): `npm run test:e2e`
  - Static checks: `npm run lint`, `npm run typecheck`
- **No new test files** for this plan — config + docs changes don't get unit tests. Verification = build/preview commands working.

---

## Task 1 — Update `.gitignore` (Vercel scrub + Cloudflare additions)

**Why first:** Subsequent tasks generate `.open-next/`, `.wrangler/`, and `cloudflare-env.d.ts` artifacts. If `.gitignore` doesn't cover them, they'd show up as untracked noise during later verification.

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Replace the Vercel block with the Cloudflare entries**

Open `.gitignore`. Lines 38–39 currently read:

```
# vercel
.vercel
```

Replace those two lines with:

```
# Cloudflare Workers / OpenNext
.open-next/
.wrangler/
cloudflare-env.d.ts
```

- [ ] **Step 2: Verify the diff**

Run:
```bash
git diff .gitignore
```

Expected: exactly the two-line removal and the four-line addition (comment + 3 entries), no other changes.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "$(cat <<'EOF'
chore(gitignore): swap Vercel artifacts for Cloudflare/OpenNext

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Install OpenNext + Wrangler dev dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the two dev dependencies**

Run:
```bash
npm install --save-dev @opennextjs/cloudflare@latest wrangler@latest
```

This adds both packages under `devDependencies` and updates `package-lock.json`.

- [ ] **Step 2: Verify the versions installed**

Run:
```bash
node -e "const p=require('./package.json'); console.log('@opennextjs/cloudflare', p.devDependencies['@opennextjs/cloudflare']); console.log('wrangler', p.devDependencies['wrangler']);"
```

Expected: both lines print a version. Wrangler must be `^4.x` (or any version ≥ 3.99.0).

If wrangler resolved to `<3.99.0`, run `npm install --save-dev wrangler@^4` and re-verify.

- [ ] **Step 3: Confirm lint and typecheck still pass**

```bash
npm run lint && npm run typecheck
```

Expected: both green. (No source changes yet, so this is just a baseline.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add @opennextjs/cloudflare and wrangler

Cloudflare Workers deploy adapter for Next 16 + the CLI to deploy/preview.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Add `wrangler.jsonc` and `open-next.config.ts`

**Files:**
- Create: `wrangler.jsonc`
- Create: `open-next.config.ts`

- [ ] **Step 1: Create `wrangler.jsonc`** at repo root with exactly this content:

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

Notes:
- `name` becomes part of the production URL (`ihs-scheduling-tool.<account>.workers.dev`). If your account already has a Worker with this name, change it here.
- `compatibility_date` must be `2024-09-23` or later for OpenNext + `nodejs_compat`. We use `2026-05-01` (recent stable).
- `global_fetch_strictly_public` is the Workers safety flag that prevents server fetches from accidentally hitting CF-internal IPs.
- `observability` enables built-in request logs in the CF dashboard.

- [ ] **Step 2: Create `open-next.config.ts`** at repo root with exactly this content:

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
```

The empty config means: in-memory caches only (no R2/KV). Per spec non-goals, we are not wiring R2 incremental cache in this pass.

- [ ] **Step 3: Generate the Cloudflare binding types** to verify wrangler reads the config:

```bash
npx wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts
```

Expected: prints something like `Generating project types...` and writes `cloudflare-env.d.ts` to repo root.

If this errors with "no config found" or schema validation issues, re-read `wrangler.jsonc` for typos.

- [ ] **Step 4: Verify `cloudflare-env.d.ts` is gitignored**

Run:
```bash
git status
```

Expected: `cloudflare-env.d.ts` does **not** appear in the untracked list (Task 1 added it to `.gitignore`). `wrangler.jsonc` and `open-next.config.ts` should appear as new untracked files.

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc open-next.config.ts
git commit -m "$(cat <<'EOF'
feat(infra): add Cloudflare Worker + OpenNext config

wrangler.jsonc: name, entrypoint, nodejs_compat, assets binding, observability.
open-next.config.ts: minimal config; no R2/KV cache (deferred).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Update `package.json` scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update the `scripts` block**

The current `scripts` block (lines 5–15 of `package.json`) is:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --exclude 'tests/**'",
    "test:watch": "vitest",
    "test:integration": "vitest run tests/integration --no-file-parallelism",
    "test:e2e": "playwright test"
  },
```

Replace it with:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
    "cf-typegen": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --exclude 'tests/**'",
    "test:watch": "vitest",
    "test:integration": "vitest run tests/integration --no-file-parallelism",
    "test:e2e": "playwright test"
  },
```

Changes:
- **Removed** `"start": "next start"` (meaningless on Workers; would mislead).
- **Added** `preview` — builds with OpenNext and runs the result on the local Workers runtime (real CF behavior locally).
- **Added** `deploy` — builds with OpenNext and ships to Cloudflare.
- **Added** `cf-typegen` — regenerates `cloudflare-env.d.ts` whenever bindings change.

- [ ] **Step 2: Verify the scripts list**

```bash
npm run
```

Expected: lists `dev`, `build`, `preview`, `deploy`, `cf-typegen`, `lint`, `typecheck`, `test`, `test:watch`, `test:integration`, `test:e2e`. No `start`.

- [ ] **Step 3: Re-run `cf-typegen` via the new script alias** to confirm it works:

```bash
npm run cf-typegen
```

Expected: regenerates `cloudflare-env.d.ts` cleanly (overwrites existing file).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
feat(scripts): add preview/deploy/cf-typegen; remove start

preview: build + run on local Workers runtime via wrangler dev.
deploy: build + ship to Cloudflare Workers.
cf-typegen: regenerate cloudflare-env.d.ts when bindings change.
start: removed (next start is meaningless on Workers).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Validate local Workers preview build (verification gate, no commit)

**Why a separate task:** If the OpenNext build or the Workers runtime can't load this app, every later step is wasted work. Verify before scrubbing docs.

**Files:** none modified.

- [ ] **Step 1: Run the preview build + local Worker**

```bash
npm run preview
```

Expected (sequence, takes ~1–2 min on first run):
1. `next build` succeeds (you've seen this output before).
2. `opennextjs-cloudflare build` runs and prints lines about converting the build to a Worker, writing `.open-next/worker.js` and `.open-next/assets/`.
3. `wrangler dev` boots and prints `Ready on http://localhost:8787`.

- [ ] **Step 2: Smoke-test the running Worker**

Open http://localhost:8787 in a browser.

Expected: the app's landing page renders. (Routes that require Supabase will fail unless you also set up `.dev.vars`, which we are not doing in this plan — landing-page render is sufficient evidence the Worker boots.)

If the page renders → proceed to Step 3.

If you see runtime errors:
- `process is not defined` or `nodejs_compat` warnings → re-check `wrangler.jsonc` compatibility_flags.
- Missing module errors → confirm both OpenNext and wrangler installed correctly (Task 2).
- Asset 404s → confirm `assets.directory` in `wrangler.jsonc` matches the OpenNext output path (`.open-next/assets`).

Fix and re-run before continuing.

- [ ] **Step 3: Stop the preview**

`Ctrl-C` in the terminal running `npm run preview`.

- [ ] **Step 4: Confirm no stray files were committed**

```bash
git status
```

Expected: clean working tree. `.open-next/` and `.wrangler/` are gitignored so they shouldn't appear.

No commit for this task.

---

## Task 6 — Scrub Vercel from documentation

Three docs files to update in one commit (related change, small surface area).

**Files:**
- Modify: `README.md`
- Modify: `docs/SCHEDULING-TOOL-PLAN.md`
- Modify: `docs/superpowers/plans/2026-05-21-nextjs-project-scaffold.md`

### Step group A — `README.md`

- [ ] **Step 1: Replace the "Deploy on Vercel" section**

Lines 32–36 currently read:

```markdown
## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
```

Replace those five lines (including the blank line after) with:

```markdown
## Deploy on Cloudflare

This app deploys to Cloudflare Workers via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare). Worker config lives in `wrangler.jsonc` at the repo root.

- **Local Worker preview:** `npm run preview` (runs the real Workers runtime against your build).
- **Manual deploy:** `npm run deploy` (builds + ships to Cloudflare).
- **CI deploys:** Workers Builds is connected to this GitHub repo — every push to `main` ships to production, every PR gets a preview URL. Configured in the Cloudflare dashboard, no `.github/workflows` needed.

See `docs/superpowers/specs/2026-05-26-cloudflare-deploy-design.md` for the full setup.
```

- [ ] **Step 2: Leave line 21 alone**

Line 21 contains `[Geist](https://vercel.com/font)` — this is a font URL maintained by Vercel; the font itself is fine, not a hosting reference. Don't touch it.

(If you'd rather decouple from Vercel entirely later, that's a separate decision — not in this spec's scope.)

### Step group B — `docs/SCHEDULING-TOOL-PLAN.md`

- [ ] **Step 3: Replace line 50** — the Tech Stack headline

Find:
```
**Next.js (React + TypeScript) on Vercel · Supabase (Postgres + Auth + Realtime + RLS + Storage) · GitHub (repo + CI/CD)**
```

Replace with:
```
**Next.js (React + TypeScript) on Cloudflare Workers · Supabase (Postgres + Auth + Realtime + RLS + Storage) · GitHub (repo + CI/CD)**
```

- [ ] **Step 4: Replace line 55** — backend logic row of the tech stack table

Find:
```
| Backend logic | Next.js server actions / route handlers (on Vercel) | Validation, orchestration, runs the CPM engine authoritatively |
```

Replace with:
```
| Backend logic | Next.js server actions / route handlers (on Cloudflare Workers via @opennextjs/cloudflare) | Validation, orchestration, runs the CPM engine authoritatively |
```

- [ ] **Step 5: Replace line 61** — CI/CD row of the tech stack table

Find:
```
| CI/CD | GitHub → Vercel | Preview deploys per PR, prod on merge to main |
```

Replace with:
```
| CI/CD | GitHub → Cloudflare Workers Builds | Preview deploys per PR, prod on merge to main |
```

- [ ] **Step 6: Replace line 67** — the CPM placement note

Find:
```
- **Authoritative recalculation** runs in a Next.js server action / route handler on Vercel.
```

Replace with:
```
- **Authoritative recalculation** runs in a Next.js server action / route handler on Cloudflare Workers.
```

- [ ] **Step 7: Replace line 738** — Phase 0 bullet under the roadmap

Find:
```
**Phase 0 — Project setup.** Next.js + TypeScript repo on GitHub; Supabase project; Vercel deploy from main; Supabase Auth scaffolding (internal login first). *Done when:* a deployed "hello" app authenticates a user.
```

Replace with:
```
**Phase 0 — Project setup.** Next.js + TypeScript repo on GitHub; Supabase project; Cloudflare Workers deploy from main (via @opennextjs/cloudflare); Supabase Auth scaffolding (internal login first). *Done when:* a deployed "hello" app authenticates a user.
```

- [ ] **Step 8: Confirm no other Vercel hosting mentions remain in this file**

```bash
grep -n -iE "vercel" docs/SCHEDULING-TOOL-PLAN.md
```

Expected: zero output. If anything remains, read the line and decide if it's a hosting reference (replace) or something else (leave). For this plan, there should be nothing left.

### Step group C — Phase 0 scaffold plan banner

- [ ] **Step 9: Add a superseded banner to the top of the Phase 0 plan**

Open `docs/superpowers/plans/2026-05-21-nextjs-project-scaffold.md`. Right after line 1 (`# Next.js Project Scaffold (Phase 0) Implementation Plan`), insert a blank line then this banner:

```markdown
> **⚠️ Superseded for hosting choice:** This plan's Task 8 (Vercel auto-deploy) is no longer current. The project now deploys to Cloudflare Workers via `@opennextjs/cloudflare`. See `docs/superpowers/specs/2026-05-26-cloudflare-deploy-design.md` and `docs/superpowers/plans/2026-05-26-cloudflare-deploy.md`. The rest of the Phase 0 plan (scaffold, lint, test, CI) is still accurate as historical context for what was built.
```

Do NOT rewrite Task 8 or other Vercel references inside the body — this is a historical completed plan, and the banner is sufficient per the Obsidian versioning convention.

### Final verification + commit for Task 6

- [ ] **Step 10: Verify Vercel scrub is complete**

```bash
grep -rniE "vercel" --include="*.md" . | grep -v node_modules | grep -v .open-next
```

Expected output (allowed remaining references):
- `README.md:21:` — Geist font URL (font reference, not hosting)
- `docs/superpowers/plans/2026-05-21-nextjs-project-scaffold.md:` — multiple lines within the body (preserved as historical, covered by banner)
- `docs/superpowers/plans/2026-05-26-cloudflare-deploy.md:` — this plan itself mentions Vercel in the scrub task descriptions
- `docs/superpowers/specs/2026-05-26-cloudflare-deploy-design.md:` — the spec mentions Vercel for context

No hosting references should remain in `README.md`, `docs/SCHEDULING-TOOL-PLAN.md`, or anywhere outside the documented exceptions above.

- [ ] **Step 11: Commit**

```bash
git add README.md docs/SCHEDULING-TOOL-PLAN.md docs/superpowers/plans/2026-05-21-nextjs-project-scaffold.md
git commit -m "$(cat <<'EOF'
docs: scrub Vercel hosting references; project now ships to Cloudflare

README: replace 'Deploy on Vercel' with 'Deploy on Cloudflare'.
SCHEDULING-TOOL-PLAN: update 5 Vercel hosting/CI mentions to Cloudflare Workers.
Phase 0 scaffold plan: add superseded banner pointing at the new deploy spec/plan.

Geist font URL in README and historical body of Phase 0 plan preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Write `docs/cloudflare-tunnel.md`

**Files:**
- Create: `docs/cloudflare-tunnel.md`

- [ ] **Step 1: Create the file** with exactly this content:

```markdown
# Cloudflare Tunnel (developer machine)

A `cloudflared` tunnel is the lightest way to share a `localhost:3000` dev server publicly (for ad-hoc demos, stakeholder review, mobile testing). It's a personal-machine tool — nothing in this repo configures it.

## One-time setup

```bash
brew install cloudflared
cloudflared tunnel login          # opens a browser; pick your CF account
cloudflared tunnel create ihs-dev # generates credentials in ~/.cloudflared/
```

The credentials JSON in `~/.cloudflared/` is sensitive — don't commit it anywhere.

## Share your local dev server

In one terminal:
```bash
npm run dev
```

In another terminal:
```bash
cloudflared tunnel --url http://localhost:3000 run ihs-dev
```

`cloudflared` prints the public hostname (a `*.cfargotunnel.com` URL by default, or your CF-mapped hostname if you've routed one).

## Adding a tunnel for a private origin (future)

If we ever need to expose a private service (e.g. a homelab box or a Python sidecar) that has no public IP, the pattern is the same — create a separate named tunnel:

```bash
cloudflared tunnel create <service-name>
cloudflared tunnel route dns <service-name> <hostname>
cloudflared tunnel --url http://<internal-host>:<port> run <service-name>
```

That's it — no architectural change to the Worker. Document the new tunnel's purpose here when you add it.
```

- [ ] **Step 2: Verify the file rendered correctly**

```bash
ls -la docs/cloudflare-tunnel.md && head -5 docs/cloudflare-tunnel.md
```

Expected: file exists, first line is `# Cloudflare Tunnel (developer machine)`.

- [ ] **Step 3: Commit**

```bash
git add docs/cloudflare-tunnel.md
git commit -m "$(cat <<'EOF'
docs: add Cloudflare Tunnel guide for local dev sharing

Three-command setup with cloudflared. Includes stub for a future
private-origin tunnel without rearchitecting the Worker.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Manual Cloudflare setup (USER ONLY — do not run from agent)

These steps require browser access to the Cloudflare dashboard and shell access on Tanner's Mac. The agent must NOT attempt them; instead, surface this checklist to the user.

- [ ] **Step 1: Install + auth `cloudflared` on the Mac**

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create ihs-dev
```

Verify: `ls ~/.cloudflared/` shows a `<uuid>.json` credentials file.

- [ ] **Step 2: Smoke-test the tunnel**

```bash
# Terminal 1:
npm run dev

# Terminal 2:
cloudflared tunnel --url http://localhost:3000 run ihs-dev
```

Expected: `cloudflared` prints a `*.cfargotunnel.com` URL; opening it in a browser loads the dev server.

Stop both terminals with Ctrl-C when done.

- [ ] **Step 3: First production deploy from the laptop (validates env-var setup)**

In the Cloudflare dashboard, create the API token first:
1. My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template
2. Copy the token, set it in your shell: `export CLOUDFLARE_API_TOKEN=<token>` (or add to `~/.zshrc`)

Then provision env vars locally for the build (the Worker needs these at deploy time):
```bash
export NEXT_PUBLIC_SUPABASE_URL=https://uluasgpcokjwowpawavl.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from .env.local>
```

Add the service-role secret to the Worker (separate, secret, runtime-only):
```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# Paste the service role key when prompted.
```

Now ship:
```bash
npm run deploy
```

Expected: prints `Uploaded ihs-scheduling-tool` and a `*.workers.dev` URL. Open it — the landing page should render. Log in as the scheduler and confirm the Riverside project loads (this proves runtime env vars are wired).

If anything is broken, **stop here** — do not wire Workers Builds until manual deploy works.

- [ ] **Step 4: Connect Workers Builds (GitHub-connected CI)**

In the Cloudflare dashboard:
1. Workers & Pages → select the `ihs-scheduling-tool` Worker → Settings → Builds → Connect repository
2. Authorize Cloudflare on GitHub, pick `tanneraiconstruct-cmd/IHS`
3. Production branch: `main`
4. Build command: `npm run deploy`
5. Deploy command: leave blank (the `deploy` script already deploys)
6. Build variables (plain): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
7. Build secrets: `SUPABASE_SERVICE_ROLE_KEY` (this also covers runtime — Workers Builds copies it to the Worker)
8. Enable "Build preview deployments for non-production branches"

Save.

- [ ] **Step 5: Verify CI**

Trigger a deploy by pushing a trivial change to a branch and opening a PR. Expected:
- A Workers Builds run appears in the dashboard for the PR
- It builds + deploys + comments on the PR with a preview URL
- Merging the PR to `main` produces a production deploy at `ihs-scheduling-tool.<account>.workers.dev`

If the preview URL works and the production URL works, the project is live.

---

## Done check

When all tasks are complete:

- `git log --oneline -10` shows commits for: gitignore swap, deps install, Worker config files, package.json scripts, docs scrub, tunnel doc. (Task 5 is verification-only, Task 8 is user-only — neither produces commits by the engineer.)
- `npm run preview` boots the app on the local Workers runtime and the landing page renders at `http://localhost:8787`.
- `grep -rniE "vercel" --include="*.md" . | grep -v node_modules` returns only the allowed historical/contextual references documented in Task 6 Step 10.
- User has completed Task 8 manual steps and the production `*.workers.dev` URL serves the app.
