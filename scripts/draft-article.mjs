/**
 * Daily article draft.
 * Claude searches the day's Miami sports news, picks one story, and writes it.
 * Writes markdown with draft: true unless AUTO_PUBLISH=true.
 */
import { writeFileSync, readdirSync, readFileSync } from 'node:fs';

const DIR = 'src/content/articles';
const KEY = process.env.ANTHROPIC_API_KEY;
const AUTO_PUBLISH = process.env.AUTO_PUBLISH === 'true';
const BYLINE = process.env.BYLINE || 'Sport Spectator Staff';

if (!KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(0); }

const recent = readdirSync(DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => (readFileSync(`${DIR}/${f}`, 'utf8').match(/^title:\s*"?(.+?)"?\s*$/m) || [])[1] || f)
  .slice(-10);

const SYSTEM = `You write for Sport Spectator, an independent Miami sports outlet.

Coverage: Dolphins, Hurricanes, Inter Miami, Heat, Marlins, Panthers, South Florida
high school football and soccer, and Miami soccer generally.

Voice:
- Plain, direct sentences. A knowledgeable person talking, not a press release.
- Lead with the specific fact that makes the story worth reading, not a windup.
- No hype adjectives, no rhetorical questions as headlines.
- Have a view. Say which thing actually matters and why.
- 500-750 words. Two or three H2 subheads.

Hard rules:
- Every factual claim must come from your searches. If you cannot verify it, leave it out.
- Never quote more than 14 words from any single source, and quote each source at most once.
  Paraphrase everything else in your own words.
- Do not reproduce article structure or phrasing from your sources.
- No betting odds, spreads, or gambling references of any kind.

OUTPUT FORMAT — this matters:
Search as much as you need. When you are finished searching, your FINAL message must
contain nothing but a single JSON object. No preamble, no explanation, no markdown fences.

{"title":"...","dek":"...","section":"dolphins|hurricanes|inter-miami|heat|high-school-football|high-school-soccer|miami-soccer|gol-gala","tags":["..."],"slug":"kebab-case-slug","body":"markdown body, no H1"}`;

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-5',
    max_tokens: 8000,
    system: SYSTEM,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Today is ${new Date().toDateString()}. Search for today's Miami sports news across our beats, `
             + `pick the single story most worth a full piece, and write it.\n\n`
             + `Do NOT repeat any of these recent headlines:\n${recent.map((h) => `- ${h}`).join('\n')}`,
    }],
  }),
});

if (!res.ok) { console.error('API error', res.status, (await res.text()).slice(0, 800)); process.exit(0); }

const data = await res.json();
const textBlocks = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text.trim());

if (!textBlocks.length) {
  console.error('No text blocks returned. stop_reason:', data.stop_reason);
  process.exit(0);
}

/**
 * With web search on, Claude narrates between tool calls, so earlier text
 * blocks are commentary. The JSON is in the last one. Fall back to slicing
 * the outermost braces if the block still has stray text around it.
 */
function extractJSON(blocks) {
  for (const raw of [...blocks].reverse()) {
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(cleaned); } catch {}
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
    }
  }
  return null;
}

const a = extractJSON(textBlocks);

if (!a || !a.title || !a.body || !a.section) {
  console.error('Could not parse model output. stop_reason:', data.stop_reason);
  console.error('--- last text block (first 1500 chars) ---');
  console.error(textBlocks[textBlocks.length - 1].slice(0, 1500));
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
const slug = a.slug || a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const esc = (s) => String(s).replace(/"/g, '\\"');

const front = [
  '---',
  `title: "${esc(a.title)}"`,
  `dek: "${esc(a.dek || '')}"`,
  `section: ${a.section}`,
  `author: ${BYLINE}`,
  `date: ${date}`,
  `draft: ${AUTO_PUBLISH ? 'false' : 'true'}`,
  `tags: [${(a.tags || []).map((t) => `"${esc(t)}"`).join(', ')}]`,
  '---',
  '',
].join('\n');

const file = `${DIR}/${date}-${slug}.md`;
writeFileSync(file, front + a.body.trim() + '\n');
console.log('Wrote', file);
console.log('Headline:', a.title);
