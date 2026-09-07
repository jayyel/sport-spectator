/**
 * Daily article draft.
 * Asks Claude to search for the day's Miami sports news, pick one story,
 * and write it. Writes a markdown file with draft: true — nothing publishes
 * until a human unchecks that box in TinaCMS.
 */
import { writeFileSync, readdirSync, readFileSync } from 'node:fs';

const DIR = 'src/content/articles';
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(0); }

// Last 10 headlines, so the model doesn't rewrite yesterday's story.
const recent = readdirSync(DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const src = readFileSync(`${DIR}/${f}`, 'utf8');
    return (src.match(/^title:\s*"?(.+?)"?$/m) || [])[1] || f;
  })
  .slice(-10);

const SYSTEM = `You write for Sport Spectator, an independent Miami sports outlet.

Coverage: Dolphins, Hurricanes, Inter Miami, Heat, Marlins, Panthers, South Florida
high school football and soccer, and Miami soccer generally.

Voice:
- Plain, direct sentences. A knowledgeable person talking, not a press release.
- Lead with the specific fact that makes the story worth reading, not a windup.
- No hype adjectives, no "in a stunning turn of events", no rhetorical questions as headlines.
- Have a view. Say which thing actually matters and why.
- 500-750 words. Two or three H2 subheads.

Hard rules:
- Every factual claim must come from your searches. If you cannot verify it, leave it out.
- Never quote more than 14 words from any single source, and quote each source at most once.
  Paraphrase everything else in your own words.
- Do not reproduce article structure or phrasing from your sources.
- No betting odds, spreads, or gambling references of any kind. This is a hard rule.

Return ONLY valid JSON, no markdown fences:
{"title":"...","dek":"...","section":"one of: dolphins|hurricanes|inter-miami|heat|high-school-football|high-school-soccer|miami-soccer|gol-gala","tags":["..."],"slug":"kebab-case-slug","body":"markdown body, no H1"}`;

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-5',
    max_tokens: 4000,
    system: SYSTEM,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Today is ${new Date().toDateString()}. Search for today's Miami sports news across all our beats, `
             + `pick the single story most worth a full piece, and write it.\n\n`
             + `Do NOT repeat any of these recent headlines:\n${recent.map((h) => `- ${h}`).join('\n')}`,
    }],
  }),
});

if (!res.ok) { console.error('API error', res.status, await res.text()); process.exit(0); }

const data = await res.json();
const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

let a;
try {
  a = JSON.parse(text.replace(/```json|```/g, '').trim());
} catch {
  console.error('Could not parse model output; no draft written.');
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
const esc = (s) => String(s).replace(/"/g, '\\"');
const front = [
  '---',
  `title: "${esc(a.title)}"`,
  `dek: "${esc(a.dek || '')}"`,
  `section: ${a.section}`,
  'author: John Lasak',
  `date: ${date}`,
  'draft: true',
  `tags: [${(a.tags || []).map((t) => `"${esc(t)}"`).join(', ')}]`,
  '---',
  '',
].join('\n');

const file = `${DIR}/${date}-${a.slug}.md`;
writeFileSync(file, front + a.body.trim() + '\n');
console.log('Wrote', file);
