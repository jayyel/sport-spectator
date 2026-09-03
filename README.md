# Sport Spectator

Miami sports coverage. Published by Sport Spectator Gol Gala LLC.

Static site on Cloudflare Pages, live data from a Cloudflare Worker.
The page reads pre-built JSON from KV, so a visitor never triggers an upstream call.

```
public/                 static site — this is what Pages deploys
  index.html
worker/                 data layer
  src/index.js          cron jobs + /api routes
  wrangler.toml
```

---

## 1. Push to GitHub

```bash
cd sport-spectator
git init && git add . && git commit -m "Initial site and data worker"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/sport-spectator.git
git push -u origin main
```

## 2. Connect Cloudflare Pages

Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.

- Repository: `sport-spectator`
- Production branch: `main`
- Framework preset: **None**
- Build command: *(leave empty)*
- Build output directory: `public`

Every push to `main` now deploys automatically. Every other branch gets its own preview URL.

Note: once a project is Git-connected you cannot switch it to Direct Upload later.

## 3. Custom domain

Pages project → **Custom domains** → add `thesportspectator.com` and `www`.
If the domain's nameservers are already on Cloudflare, the DNS records are created for you.

## 4. Deploy the Worker

```bash
cd worker
npm install -g wrangler
wrangler login

# Create the KV namespace, then paste the returned id into wrangler.toml
wrangler kv namespace create SS

# Secrets — these never touch the repo
wrangler secret put ADMIN_KEY          # any long random string
wrangler secret put IG_TOKEN           # see step 5
wrangler secret put ANTHROPIC_API_KEY  # optional, for games-of-the-week

wrangler deploy
```

Then edit `public/index.html` and set `API` to the Worker URL wrangler prints.

Better long-term: put the Worker on a route so there's no cross-origin hop. In the
Worker's settings add the route `thesportspectator.com/api/*`, then set `API = ''`
in `index.html`.

Warm the cache immediately instead of waiting for the first cron:

```bash
curl "https://YOUR-WORKER-URL/api/refresh?key=YOUR_ADMIN_KEY"
```

## 5. Instagram token

@thesportspectator is already a Business account, so this is straightforward.
Because you own the account and will add it to your own app, Standard Access is
enough — no App Review needed for reading your own media.

1. developers.facebook.com → your app → add the **Instagram** product
2. Configure **Business login**, scope `instagram_business_basic`
3. Add @thesportspectator under **Instagram → API setup**
4. Generate a token, exchange it for a long-lived one, set it as `IG_TOKEN`

The Worker refreshes the token weekly. Long-lived tokens last 60 days and can be
refreshed any time after 24 hours, so this stays alive on its own — but if the
grid ever goes blank, an expired token is the first thing to check.

## 6. Games of the week

Monday 7am ET the Worker asks Claude to search the week's schedules and propose
three games, and writes them to `gow:proposal`.

```bash
# see the proposal
curl "https://YOUR-WORKER-URL/api/games-of-week/proposal"

# publish it
curl "https://YOUR-WORKER-URL/api/games-of-week/approve?key=YOUR_ADMIN_KEY"
```

To override with your own picks, write directly to `gow:current`:

```bash
wrangler kv key put --binding=SS gow:current '{"games":[
  {"comp":"La Liga · El Clásico","matchup":"Real Madrid vs Barcelona",
   "when":"Sun 3:15 PM · ESPN+","why":"Both sides arrive unbeaten under new managers."}
]}'
```

The first proposal auto-publishes so the row is never empty. After that it waits
for you.

---

## What updates on its own

| | Source | Frequency | Cost |
|---|---|---|---|
| Miami slate, live scores | ESPN public JSON | 60 seconds | free |
| Live wire | Google News RSS | 15 minutes | free |
| Instagram grid | Instagram Graph API | 6 hours | free |
| Games of the week | Claude, then your approval | weekly | ~$0.05/wk |
| Articles | you and your writers | — | — |

Cloudflare Workers Free covers this, though the every-minute cron makes the $5
paid plan worth it for headroom.

## Known limits

- ESPN's endpoints are undocumented and unofficial. They work well and cost
  nothing, but there's no SLA. The Worker fails soft per league — if one breaks,
  the rest of the slate still renders and the league name lands in `failed`.
- Live game status strings vary by sport (`Bot 6`, `Q3 4:12`, `72'`). They render
  as ESPN provides them.
- The wire stores headline, source and link only. Never article text.
