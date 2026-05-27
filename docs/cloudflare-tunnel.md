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
