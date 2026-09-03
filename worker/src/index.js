/**
 * Sport Spectator — data Worker
 * Sport Spectator Gol Gala LLC
 *
 * Cron jobs write to KV. The site reads from KV via /api/*.
 * Nothing here is called from the browser directly, so tokens never leave the edge.
 */

const TEAMS = {
  dolphins:   { league: 'nfl',             path: 'football/nfl',              abbr: 'MIA', name: 'Dolphins',     accent: 'dol'  },
  hurricanes: { league: 'ncaaf',           path: 'football/college-football', abbr: 'MIA', name: 'Hurricanes',   accent: 'can'  },
  marlins:    { league: 'mlb',             path: 'baseball/mlb',              abbr: 'MIA', name: 'Marlins',      accent: 'mia'  },
  heat:       { league: 'nba',             path: 'basketball/nba',            abbr: 'MIA', name: 'Heat',         accent: 'heat' },
  panthers:   { league: 'nhl',             path: 'hockey/nhl',                abbr: 'FLA', name: 'Panthers',     accent: 'pan'  },
  intermiami: { league: 'mls',             path: 'soccer/usa.1',              abbr: 'MIA', name: 'Inter Miami',  accent: 'imcf' },
};

// Google News RSS queries for the live wire, in priority order.
const WIRE_QUERIES = [
  { tag: 'Dolphins',    accent: 'dol',  q: '"Miami Dolphins"' },
  { tag: 'Canes',       accent: 'can',  q: '"Miami Hurricanes" football' },
  { tag: 'Inter Miami', accent: 'imcf', q: '"Inter Miami"' },
  { tag: 'Marlins',     accent: 'mia',  q: '"Miami Marlins"' },
  { tag: 'Heat',        accent: 'heat', q: '"Miami Heat"' },
  { tag: 'Panthers',    accent: 'pan',  q: '"Florida Panthers" NHL' },
  { tag: 'High School', accent: 'cyan', q: 'Miami-Dade high school football OR soccer' },
];

const UA = 'SportSpectator/1.0 (+https://thesportspectator.com)';
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

function yyyymmdd(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchLeague(team) {
  const from = new Date();
  const to = new Date(Date.now() + 6 * 864e5);
  const url = `https://site.api.espn.com/apis/site/v2/sports/${team.path}/scoreboard`
            + `?dates=${yyyymmdd(from)}-${yyyymmdd(to)}&limit=100`;

  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${team.league} ${res.status}`);
  const data = await res.json();

  return (data.events || [])
    .map((ev) => parseEvent(ev, team))
    .filter(Boolean);
}

function parseEvent(ev, team) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;

  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home');
  const away = cs.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  // Only keep games our team is actually in.
  const mine = [home, away].find((c) => c.team?.abbreviation === team.abbr);
  if (!mine) return null;

  const status = comp.status?.type || {};
  const state = status.state;                     // pre | in | post
  const side = (c) => ({
    abbr:   c.team?.abbreviation || '',
    name:   c.team?.shortDisplayName || c.team?.name || '',
    score:  c.score ?? null,
    record: c.records?.[0]?.summary || '',
    isMine: c.team?.abbreviation === team.abbr,
  });

  return {
    id: ev.id,
    league: team.league,
    leagueLabel: labelFor(team.league),
    teamKey: Object.keys(TEAMS).find((k) => TEAMS[k] === team),
    accent: team.accent,
    start: ev.date,
    state,
    statusDetail: status.shortDetail || '',
    network: comp.broadcasts?.[0]?.names?.[0] || '',
    venue: comp.venue?.fullName || '',
    away: side(away),
    home: side(home),
  };
}

function labelFor(l) {
  return { nfl: 'NFL', ncaaf: 'NCAA', mlb: 'MLB', nba: 'NBA', nhl: 'NHL', mls: 'MLS' }[l] || l.toUpperCase();
}

async function buildSlate(env) {
  const results = await Promise.allSettled(
    Object.values(TEAMS).map((t) => fetchLeague(t))
  );

  let games = [];
  const failed = [];
  results.forEach((r, i) => {
    const key = Object.keys(TEAMS)[i];
    if (r.status === 'fulfilled') games = games.concat(r.value);
    else failed.push(key);
  });

  // Live first, then chronological. Cap at what the rail can hold.
  games.sort((a, b) => {
    if (a.state === 'in' && b.state !== 'in') return -1;
    if (b.state === 'in' && a.state !== 'in') return 1;
    return new Date(a.start) - new Date(b.start);
  });

  const payload = {
    updated: new Date().toISOString(),
    failed,
    games: games.slice(0, 14),
  };
  await env.SS.put('slate', JSON.stringify(payload));
  return payload;
}

/* ------------------------------------------------------------------ */
/* Live wire — Google News RSS                                         */
/* ------------------------------------------------------------------ */

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

async function fetchWireFor(entry) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(entry.q + ' when:2d')}`
            + `&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) return [];
  const xml = await res.text();

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 4);
  return items.map((m) => {
    const block = m[1];
    const raw = decode((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = decode((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const date = decode((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '');

    // Google formats titles as "Headline - Publisher"
    const cut = raw.lastIndexOf(' - ');
    const headline = cut > 20 ? raw.slice(0, cut) : raw;
    const source = cut > 20 ? raw.slice(cut + 3) : '';

    return { tag: entry.tag, accent: entry.accent, headline, source, link, date };
  }).filter((i) => i.headline);
}

async function buildWire(env) {
  const results = await Promise.allSettled(WIRE_QUERIES.map(fetchWireFor));
  const byTag = results.map((r) => (r.status === 'fulfilled' ? r.value : []));

  // Round-robin so no single team floods the ticker.
  const wire = [];
  for (let i = 0; i < 4; i++) {
    for (const list of byTag) if (list[i]) wire.push(list[i]);
  }

  // Drop near-duplicate headlines.
  const seen = new Set();
  const deduped = wire.filter((item) => {
    const key = item.headline.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const payload = { updated: new Date().toISOString(), items: deduped.slice(0, 14) };
  await env.SS.put('wire', JSON.stringify(payload));
  return payload;
}

/* ------------------------------------------------------------------ */
/* Instagram — @thesportspectator                                      */
/* ------------------------------------------------------------------ */

async function buildInstagram(env) {
  const token = await env.SS.get('ig:token') || env.IG_TOKEN;
  if (!token) return { items: [], error: 'no token' };

  const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp';
  const res = await fetch(`https://graph.instagram.com/me/media?fields=${fields}&limit=6&access_token=${token}`);
  if (!res.ok) return { items: [], error: `ig ${res.status}` };

  const data = await res.json();
  const items = (data.data || []).map((m) => ({
    id: m.id,
    permalink: m.permalink,
    // Videos and reels expose a still under thumbnail_url.
    image: m.media_type === 'VIDEO' ? (m.thumbnail_url || m.media_url) : m.media_url,
    type: m.media_type,
    caption: (m.caption || '').slice(0, 140),
    timestamp: m.timestamp,
  }));

  const payload = { updated: new Date().toISOString(), items };
  await env.SS.put('instagram', JSON.stringify(payload));
  return payload;
}

/**
 * Long-lived tokens last 60 days and can be refreshed any time after 24 hours.
 * This runs weekly so the grid never silently dies.
 */
async function refreshInstagramToken(env) {
  const token = await env.SS.get('ig:token') || env.IG_TOKEN;
  if (!token) return;
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
  if (!res.ok) return;
  const data = await res.json();
  if (data.access_token) await env.SS.put('ig:token', data.access_token);
}

/* ------------------------------------------------------------------ */
/* Games of the week — Claude proposes, you approve                    */
/* ------------------------------------------------------------------ */

const GOW_SYSTEM = `You are the sports editor for Sport Spectator, a Miami sports outlet.
Pick the three biggest games happening anywhere in the world in the coming week — any sport, any league.
Judge by genuine significance: stakes, rivalry, storyline, star power. Miami games qualify on merit, not by default.
Return ONLY a JSON array of exactly 3 objects, ranked 1-3, no markdown fences, no preamble. Each object:
{"comp":"League and round, under 30 chars","matchup":"Team vs Team, under 34 chars","when":"Day H:MM AM/PM · Network","why":"One sentence, under 110 chars, saying why it matters. No hype words."}`;

async function proposeGamesOfWeek(env) {
  if (!env.ANTHROPIC_API_KEY) return;

  const slate = JSON.parse((await env.SS.get('slate')) || '{"games":[]}');
  const today = new Date().toDateString();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      system: GOW_SYSTEM,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Today is ${today}. Search for the major sporting events scheduled over the next seven days, `
               + `then pick the three biggest. Miami's own slate this week, for reference: `
               + JSON.stringify(slate.games.map((g) => `${g.away.name} at ${g.home.name} (${g.leagueLabel})`)),
      }],
    }),
  });

  if (!res.ok) return;
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (Array.isArray(parsed) && parsed.length === 3) {
      await env.SS.put('gow:proposal', JSON.stringify({ proposed: new Date().toISOString(), games: parsed }));
      // If nothing is published yet, publish the proposal so the row is never empty.
      if (!(await env.SS.get('gow:current'))) {
        await env.SS.put('gow:current', JSON.stringify({ updated: new Date().toISOString(), games: parsed }));
      }
    }
  } catch (e) {
    // Bad JSON: leave last week's picks in place rather than publishing garbage.
  }
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url);
    const read = async (key, fallback, maxAge) =>
      json(JSON.parse((await env.SS.get(key)) || fallback), maxAge);

    switch (pathname) {
      case '/api/slate':
        return read('slate', '{"games":[]}', 45);
      case '/api/wire':
        return read('wire', '{"items":[]}', 300);
      case '/api/instagram':
        return read('instagram', '{"items":[]}', 3600);
      case '/api/games-of-week':
        return read('gow:current', '{"games":[]}', 900);
      case '/api/games-of-week/proposal':
        return read('gow:proposal', '{"games":[]}', 60);

      // Approve this week's proposal. Protected by a shared secret.
      case '/api/games-of-week/approve': {
        if (searchParams.get('key') !== env.ADMIN_KEY) return new Response('nope', { status: 403 });
        const proposal = await env.SS.get('gow:proposal');
        if (!proposal) return new Response('no proposal', { status: 404 });
        const { games } = JSON.parse(proposal);
        await env.SS.put('gow:current', JSON.stringify({ updated: new Date().toISOString(), games }));
        return json({ ok: true, games });
      }

      // Manual trigger for testing crons locally.
      case '/api/refresh': {
        if (searchParams.get('key') !== env.ADMIN_KEY) return new Response('nope', { status: 403 });
        await Promise.allSettled([buildSlate(env), buildWire(env), buildInstagram(env)]);
        return json({ ok: true });
      }

      default:
        return new Response('Sport Spectator API', { status: 404 });
    }
  },

  async scheduled(event, env, ctx) {
    const minute = new Date(event.scheduledTime).getUTCMinutes();
    const hour = new Date(event.scheduledTime).getUTCHours();
    const day = new Date(event.scheduledTime).getUTCDay();

    const jobs = [buildSlate(env)];                      // every run
    if (minute % 15 === 0) jobs.push(buildWire(env));    // every 15 min
    if (minute === 0 && hour % 6 === 0) jobs.push(buildInstagram(env));
    if (day === 1 && hour === 6 && minute === 0) jobs.push(refreshInstagramToken(env));
    if (day === 1 && hour === 11 && minute === 0) jobs.push(proposeGamesOfWeek(env)); // Mon 7am ET

    ctx.waitUntil(Promise.allSettled(jobs));
  },
};
