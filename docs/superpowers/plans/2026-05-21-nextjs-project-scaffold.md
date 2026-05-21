# Next.js Project Scaffold (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a buildable, tested, CI-wired Next.js + TypeScript application as the foundation for the IHS construction scheduling tool.

**Architecture:** Next.js 15 (App Router) + TypeScript + Tailwind CSS, all source under `src/`. Vitest runs unit tests. A GitHub Actions workflow runs lint + typecheck + test + build on every push to `main` and every pull request. The repo is left structured so the pure CPM engine (Phase 1) and Supabase integration (later plans) drop in without restructuring.

**Tech Stack:** Next.js 15, React 19, TypeScript 5, Tailwind CSS 4, Vitest, ESLint, GitHub Actions, Vercel.

**Repo context:** Git is already initialized; `origin` is `https://github.com/tanneraiconstruct-cmd/IHS.git`; `gh` CLI is authenticated as `tanneraiconstruct-cmd`. `main` already has two commits (a stub README and the planning spec).

**Out of scope (deferred to later plans):** Supabase project + client wiring, Supabase Auth, the CPM scheduling engine (Phase 1), and all UI components beyond a placeholder landing page. This plan stops at "a deployed Next.js app that builds green in CI."

---

### Task 1: Reorganize the repo so the scaffolder can run

`create-next-app` refuses to run in a directory containing files it doesn't recognize. `SCHEDULING-TOOL-PLAN.md` is such a file. Move it into `docs/` (which the scaffolder allows) and delete the GitHub-generated stub README (the scaffolder generates its own).

**Files:**
- Move: `SCHEDULING-TOOL-PLAN.md` → `docs/SCHEDULING-TOOL-PLAN.md`
- Delete: `README.md`

- [ ] **Step 1: Move the planning spec into `docs/`**

```bash
mkdir -p docs
git mv "SCHEDULING-TOOL-PLAN.md" "docs/SCHEDULING-TOOL-PLAN.md"
```

- [ ] **Step 2: Remove the stub README**

```bash
git rm README.md
```

- [ ] **Step 3: Verify the root now contains only scaffolder-safe entries**

Run: `ls -A`
Expected: `.DS_Store`, `.git`, `.gitignore`, `docs` — and nothing else. (All four are on `create-next-app`'s allowlist.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: move planning spec into docs/ ahead of scaffolding"
```

---

### Task 2: Scaffold the Next.js application

**Files:**
- Create: entire Next.js app tree (`package.json`, `package-lock.json`, `src/app/`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore`, etc.)

- [ ] **Step 1: Run the scaffolder in the current directory**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```

Expected: the scaffolder runs without a "directory not empty" error, installs dependencies, and prints `Success! Created ...`. It detects the existing git repo and does NOT create a new commit.

- [ ] **Step 2: Set a clean package name**

Open `package.json` and set the `name` field exactly:

```json
"name": "ihs-scheduling-tool",
```

(The scaffolder derives a messy name from the directory `IHS- Scheduling Tool`; replace it.)

- [ ] **Step 3: Append IDE entries to `.gitignore`**

The scaffolder overwrites `.gitignore` with the Next.js default, which omits IDE folders. Append these lines to the end of `.gitignore`:

```gitignore

# Editor / IDE
.idea/
.vscode/
*.swp
```

- [ ] **Step 4: Verify the production build succeeds**

Run: `npm run build`
Expected: `✓ Compiled successfully` and a route table listing `/`. Exit code 0.

- [ ] **Step 5: Verify the dev server boots**

Run: `npm run dev`, then open `http://localhost:3000`.
Expected: the default Next.js welcome page renders. Stop the server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js + TypeScript + Tailwind application"
```

---

### Task 3: Configure Vitest and project scripts

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (`scripts` block)

- [ ] **Step 1: Install Vitest and the tsconfig-paths resolver**

```bash
npm install -D vitest vite-tsconfig-paths
```

Expected: both packages added to `devDependencies`.

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Set the `scripts` block in `package.json`**

Edit `package.json` so the `scripts` block matches exactly (this normalizes `lint` to the ESLint CLI and adds `typecheck` + test scripts):

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 4: Verify the test runner works with no tests yet**

Run: `npm test`
Expected: `No test files found, exiting with code 0` (exit code 0).

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: configure Vitest and add typecheck/test scripts"
```

---

### Task 4: Add the `cn` class-name utility (TDD — proves the test pipeline end to end)

A real, reused utility: `cn()` merges Tailwind class strings and drops falsy values. Building it test-first proves Vitest, the `@/*` alias, and TypeScript all work together.

**Files:**
- Test: `src/lib/utils.test.ts`
- Create: `src/lib/utils.ts`

- [ ] **Step 1: Install the runtime dependencies**

```bash
npm install clsx tailwind-merge
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins class names with a space", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes so the last wins", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./utils"` (the file does not exist yet).

- [ ] **Step 4: Write the minimal implementation**

Create `src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — `3 passed`, exit code 0.

- [ ] **Step 6: Verify lint and typecheck still pass**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0 with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add cn class-name utility with tests"
```

---

### Task 5: Replace the default landing page

**Files:**
- Modify: `src/app/page.tsx` (full replacement)
- Modify: `src/app/layout.tsx` (metadata only)

- [ ] **Step 1: Replace the page content**

Overwrite `src/app/page.tsx` entirely with:

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">
        IHS Scheduling Tool
      </h1>
      <p className="text-sm text-gray-500">
        Construction scheduling — Phase 0 scaffold. Build in progress.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Update the page metadata**

In `src/app/layout.tsx`, change the `metadata` object's strings:

```ts
export const metadata: Metadata = {
  title: "IHS Scheduling Tool",
  description: "Construction scheduling tool",
};
```

- [ ] **Step 3: Verify the build still succeeds**

Run: `npm run build`
Expected: `✓ Compiled successfully`, exit code 0.

- [ ] **Step 4: Verify the page renders**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: the "IHS Scheduling Tool" heading renders. Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add placeholder landing page"
```

---

### Task 6: Add the GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "ci: add GitHub Actions workflow for lint, typecheck, test, build"
```

---

### Task 7: Push and verify CI passes

- [ ] **Step 1: Push all commits to GitHub**

```bash
git push
```

Expected: all commits from Tasks 1–6 land on `origin/main`.

- [ ] **Step 2: Watch the CI run**

```bash
gh run watch
```

Expected: the `verify` job completes with all five steps (`npm ci`, lint, typecheck, test, build) green. If any step fails, fix the underlying issue, commit, push, and re-watch — do not merge around a red CI.

---

### Task 8: Connect Vercel for auto-deploy (MANUAL — requires the repo owner)

This task cannot be automated — it is a browser OAuth flow. Hand this checklist to the user.

- [ ] **Step 1:** Go to `https://vercel.com`, sign in (use "Continue with GitHub").
- [ ] **Step 2:** Click **Add New… → Project**.
- [ ] **Step 3:** Import the `tanneraiconstruct-cmd/IHS` repository. (Grant Vercel access to the repo if prompted.)
- [ ] **Step 4:** Confirm the **Framework Preset** auto-detects as **Next.js**. Leave build settings at defaults. No environment variables are needed yet.
- [ ] **Step 5:** Click **Deploy**. Wait for the first production deployment to finish.

**Done when:** the Vercel production URL serves the "IHS Scheduling Tool" landing page, and opening a pull request against `main` produces a Vercel preview deployment URL automatically.

---

## Completion Criteria

- `npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`, and `npm test` all succeed locally.
- GitHub Actions CI is green on `main`.
- Vercel serves the landing page in production and creates preview deploys for PRs.
- The repo is structured (`src/`, `src/lib/`) so the Phase 1 CPM engine can be added under `src/lib/schedule-engine/` in the next plan with no restructuring.
