This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Cloudflare

This app deploys to Cloudflare Workers via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare). Worker config lives in `wrangler.jsonc` at the repo root.

- **Local Worker preview:** `npm run preview` (runs the real Workers runtime against your build).
- **Manual deploy:** `npm run deploy` (builds + ships to Cloudflare).
- **CI deploys:** Workers Builds is connected to this GitHub repo — every push to `main` ships to production, every PR gets a preview URL. Configured in the Cloudflare dashboard, no `.github/workflows` needed.

See `docs/superpowers/specs/2026-05-26-cloudflare-deploy-design.md` for the full setup.
