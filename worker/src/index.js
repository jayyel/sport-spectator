/**
 * Sport Spectator — data Worker
 * Sport Spectator Gol Gala LLC
 *
 * Cron jobs write to KV. The site reads from KV via /api/*.
 * Static assets are served first; anything with no matching file lands here.
 */

const TEAMS = {
  dolphins:   { league: 'nfl',   path: 'football/nfl',              abbr: 'MIA', name: 'Dolphins',    accent: 'dol'  },
  hurricanes: { league: 'ncaaf', path: 'football/college-football', abbr: 'MIA', name: 'Hurricanes',  accent: 'can'  },
  marlins:    { league: 'mlb',   path: 'baseball/mlb',              abbr: 'MIA', name: 'Marlins',     accent: 'mia'  },
  heat:       { league: 'nba',   path: 'basketball/nba',            abbr: 'MIA', name: 'Heat',        accent: 'heat' },
  panthers:   { league: 'nhl',   path: 'hockey/nhl',                abbr: 'FLA', name: 'Panthers',    accent: 'pan'  },
  intermiami: { league: 'mls',   path: 'soccer/usa.1',              abbr: 'MIA', name: 'Inter Miami', accent: 'imcf' },
};

const WIRE_QUERIES = [
  { tag: 'Dolphins',    accent: 'dol',  q: '"Miami Dolphins"' },
  { tag: 'Canes',       accent: 'can',  q: '"Miami Hurricanes" football' },
  { tag: 'Inter Miami', accent: 'imcf', q: '"Inter Miami"' },
  { tag: 'Marlins',     accent: 'mia',  q: '"Miami Marlins"' },
  { tag: 'Heat',        accent: 'heat', q: '"Miami Heat"' },
  { tag: 'Panthers',    accent: 'pan',  q: '"Florida Panthers" NHL' },
  { tag: 'High School', accent: 'cyan', q: 'Miami-Dade high school football OR soccer' },
];

/**
 * ESPN changed its user-agent filter on 2026-08-04 and it runs backwards
 * from the usual one: browser strings and bare custom tokens are refused,
 * while honest client tokens (with a link) and plain curl/requests defaults
 * are allowed. Sending a Chrome string is the one guaranteed 403.
 *
 * We try these in order and cache whichever works, so steady-state is a
 * single request per league.
 */
const AGENTS = [
  'SportSpectator/1.0 (+https://thesportspectator.com)',
  'curl/8.20.0',
  'python-requests/2.32.3',
  'Mozilla/5.0 (compatible; SportSpectator/1.0; +https://thesportspectator.com)',
];

async function espnFetch(url, env) {
  const cached = await env.SS.get('espn:ua');
  const order = cached ? [cached, ...AGENTS.filter((a) => a !== cached)] : AGENTS;
  let lastError = 'unknown';

  for (const ua of order) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': ua } });
      if (!res.ok) { lastError = `HTTP ${res.status} (ua: ${ua.slice(0, 24)})`; continue; }

      const ctype = res.headers.get('content-type') || '';
      if (!ctype.includes('json')) {
        lastError = `non-JSON ${ctype} (ua: ${ua.slice(0, 24)})`;
        continue;
      }

      const data = await res.json();
      if (ua !== cached) await env.SS.put('espn:ua', ua);
      return { data, ua };
    } catch (e) {
      lastError = `${e.name}: ${e.message}`.slice(0, 120);
    }
  }
  return { error: lastError };
}

const json = (data, maxAge = 60) =>
  new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      'access-control-allow-origin': '*',
    },
  });

/* ------------------------------------------------------------------ */
/* Slate — ESPN scoreboards                                            */
/* ------------------------------------------------------------------ */

const yyyymmdd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

function urlsFor(team) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/${team.path}/scoreboard`;
  const from = yyyymmdd(new Date());
  const to = yyyymmdd(new Date(Date.now() + 6 * 864e5));
  return [
    `${base}?dates=${from}-${to}&limit=100`,  // preferred: whole week
    base,                                      // fallback: today only
  ];
}

/**
 * Never throws. Returns { games, error } so a failure is visible
 * in the payload rather than collapsing to a league name.
 */
async function fetchLeague(team, env) {
  let lastError = 'unknown';

  for (const url of urlsFor(team)) {
    const { data, error, ua } = await espnFetch(url, env);
    if (error) { lastError = error; continue; }

    const events = data.events || [];
    const games = events.map((ev) => parseEvent(ev, team)).filter(Boolean);
    // A valid response with no matching games isn't an error — this team
    // simply isn't playing in the window.
    return { games, error: null, sawEvents: events.length, ua };
  }

  return { games: [], error: lastError, sawEvents: 0 };
}

function parseEvent(ev, team) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;

  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home');
  const away = cs.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  // Match on abbreviation, then fall back to name — ESPN is inconsistent
  // about abbreviations in soccer and college feeds.
  const matches = (c) => {
    const t = c.team || {};
    if (t.abbreviation === team.abbr) return true;
    const names = [t.displayName, t.shortDisplayName, t.name, t.location]
      .filter(Boolean).map((s) => s.toLowerCase());
    return names.some((n) => n.includes(team.name.toLowerCase()));
  };
  if (!cs.some(matches)) return null;

  const status = comp.status?.type || {};
  const side = (c) => ({
    abbr:   c.team?.abbreviation || (c.team?.shortDisplayName || '').slice(0, 3).toUpperCase(),
    name:   c.team?.shortDisplayName || c.team?.name || '',
    score:  c.score ?? null,
    record: c.records?.[0]?.summary || '',
    isMine: matches(c),
  });

  return {
    id: ev.id,
    league: team.league,
    leagueLabel: { nfl:'NFL', ncaaf:'NCAA', mlb:'MLB', nba:'NBA', nhl:'NHL', mls:'MLS' }[team.league],
    accent: team.accent,
    start: ev.date,
    state: status.state,                 // pre | in | post
    statusDetail: status.shortDetail || '',
    network: comp.broadcasts?.[0]?.names?.[0] || '',
    venue: comp.venue?.fullName || '',
    away: side(away),
    home: side(home),
  };
}

async function buildSlate(env) {
  const keys = Object.keys(TEAMS);
  const results = await Promise.all(keys.map((k) => fetchLeague(TEAMS[k], env)));

  let games = [];
  const errors = {};
  const diagnostics = {};

  results.forEach((r, i) => {
    games = games.concat(r.games);
    diagnostics[keys[i]] = { found: r.games.length, sawEvents: r.sawEvents };
    if (r.error) errors[keys[i]] = r.error;
  });

  games.sort((a, b) => {
    if (a.state === 'in' && b.state !== 'in') return -1;
    if (b.state === 'in' && a.state !== 'in') return 1;
    return new Date(a.start) - new Date(b.start);
  });

  const payload = {
    updated: new Date().toISOString(),
    errors,
    diagnostics,
    games: games.slice(0, 14),
  };
  await env.SS.put('slate', JSON.stringify(payload));
  return payload;
}

/* ------------------------------------------------------------------ */
/* Live wire — Google News RSS                                         */
/* ------------------------------------------------------------------ */

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/<[^>]+>/g, '').trim();

async function fetchWireFor(entry) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(entry.q + ' when:2d')}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { 'user-agent': AGENTS[0] } });
  if (!res.ok) return [];
  const xml = await res.text();

  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 4).map((m) => {
    const b = m[1];
    const raw  = decode((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = decode((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const date = decode((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '');
    const cut = raw.lastIndexOf(' - ');
    return {
      tag: entry.tag,
      accent: entry.accent,
      headline: cut > 20 ? raw.slice(0, cut) : raw,
      source:   cut > 20 ? raw.slice(cut + 3) : '',
      link, date,
    };
  }).filter((i) => i.headline);
}

async function buildWire(env) {
  const results = await Promise.allSettled(WIRE_QUERIES.map(fetchWireFor));
  const byTag = results.map((r) => (r.status === 'fulfilled' ? r.value : []));

  const wire = [];
  for (let i = 0; i < 4; i++) for (const list of byTag) if (list[i]) wire.push(list[i]);

  const seen = new Set();
  const items = wire.filter((it) => {
    const k = it.headline.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 14);

  const payload = { updated: new Date().toISOString(), items };
  await env.SS.put('wire', JSON.stringify(payload));
  return payload;
}

/* ------------------------------------------------------------------ */
/* Newsletter — beehiiv                                                */
/* ------------------------------------------------------------------ */

async function subscribe(request, env) {
  if (!env.BEEHIIV_API_KEY || !env.BEEHIIV_PUB_ID) {
    return json({ error: 'newsletter not configured' }, 0);
  }
  let email;
  try { ({ email } = await request.json()); } catch { return json({ error: 'bad body' }, 0); }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'invalid email' }), { status: 400 });
  }

  const res = await fetch(`https://api.beehiiv.com/v2/publications/${env.BEEHIIV_PUB_ID}/subscriptions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${env.BEEHIIV_API_KEY}`,
    },
    body: JSON.stringify({
      email,
      reactivate_existing: false,
      send_welcome_email: true,
      utm_source: 'thesportspectator.com',
    }),
  });

  if (!res.ok) return new Response(JSON.stringify({ error: 'upstream' }), { status: 502 });
  return json({ ok: true }, 0);
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url);
    const read = async (key, fallback, maxAge) =>
      json(JSON.parse((await env.SS.get(key)) || fallback), maxAge);
    const auth = () => searchParams.get('key') === env.ADMIN_KEY;

    switch (pathname) {
      case '/api/slate':          return read('slate', '{"games":[]}', 45);
      case '/api/wire':           return read('wire', '{"items":[]}', 300);
      case '/api/games-of-week':  return read('gow:current', '{"games":[]}', 900);
      case '/api/subscribe':      return subscribe(request, env);

      /**
       * Raw upstream response for one league, so a failure can be read
       * directly instead of inferred. /api/debug?key=...&league=marlins
       */
      case '/api/debug': {
        if (!auth()) return new Response('nope', { status: 403 });
        const key = searchParams.get('league') || 'marlins';
        const team = TEAMS[key];
        if (!team) return json({ error: 'unknown league', valid: Object.keys(TEAMS) }, 0);

        const url = urlsFor(team)[0];
        const tried = [];
        for (const ua of AGENTS) {
          try {
            const res = await fetch(url, { headers: { 'user-agent': ua } });
            const ctype = res.headers.get('content-type') || '';
            tried.push({ ua, status: res.status, contentType: ctype });
          } catch (e) {
            tried.push({ ua, threw: `${e.name}: ${e.message}`.slice(0, 100) });
          }
        }
        return json({ url, cachedAgent: await env.SS.get('espn:ua'), tried }, 0);
      }

      case '/api/refresh': {
        if (!auth()) return new Response('nope', { status: 403 });
        const slate = await buildSlate(env);
        await buildWire(env);
        return json({ ok: true, games: slate.games.length, errors: slate.errors, diagnostics: slate.diagnostics }, 0);
      }

      default:
        return new Response('Sport Spectator API', { status: 404 });
    }
  },

  async scheduled(event, env, ctx) {
    const t = new Date(event.scheduledTime);
    const jobs = [buildSlate(env)];
    if (t.getUTCMinutes() % 15 === 0) jobs.push(buildWire(env));
    ctx.waitUntil(Promise.allSettled(jobs));
  },
};
