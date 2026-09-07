# Sport Spectator

Miami sports coverage. Published by Sport Spectator Gol Gala LLC.

```
wrangler.toml            one Worker serves the site + /api/*
astro.config.mjs
public/index.html        homepage — copied verbatim by Astro, untouched
src/
  content/articles/*.md  articles (TinaCMS edits these)
  content.config.ts      frontmatter schema
  layouts/               Base + Article
  pages/                 /articles, /section/[section], /articles.json
worker/src/index.js      cron jobs + API routes
tina/config.ts           CMS schema
scripts/draft-article.mjs
.github/workflows/daily-article.yml
```

## Cloudflare build settings

Change the build configuration on the `sport-spectator` Worker:

- **Build command:** `npm install && npm run build`
- **Deploy command:** `npx wrangler deploy`
- **Root directory:** `/`

Astro outputs to `dist/`, which is what `wrangler.toml` now serves.
`public/` is copied into `dist/` verbatim, so the homepage is unchanged.

## URLs

| Path | What |
|---|---|
| `/` | homepage (public/index.html) |
| `/articles/` | all coverage |
| `/articles/<slug>/` | an article |
| `/section/dolphins/` | section index (one per section) |
| `/articles.json` | feed the homepage Latest list reads |
| `/admin/` | TinaCMS |
| `/api/*` | Worker |

## Daily drafts

`.github/workflows/daily-article.yml` runs at 06:00 ET. Claude searches the day's
news, writes one piece, and commits it with `draft: true`. Nothing publishes until
you uncheck Draft in TinaCMS.

Required GitHub secrets: `ANTHROPIC_API_KEY`.
Optional, for the SMS ping: `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `TWILIO_TO`.

Run it by hand any time from the Actions tab via "Run workflow".

## Article images

Every article gets a designed card automatically — section colour, spectrum rail,
headline, Sport Spectator mark. No file needed, no licensing exposure, and it
applies to future articles without any extra work.

To use a real photograph instead, add to the frontmatter:

```yaml
image: /images/gol-gala-final-2026.jpg
imageAlt: "Two players challenge for a header at OB Johnson Park"
imageCredit: "Unico Creative Studio"
```

Put the file in `public/images/`. It overrides the card everywhere — article page,
index, section page and homepage.

Only publish photographs you own or have licensed. Wire photos (AP, Getty, Imagn)
and team-issued press images are not usable without a licence or credential.
