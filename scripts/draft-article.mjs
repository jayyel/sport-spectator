/**
 * Daily article draft.
 * Claude searches the day's Miami sports news, picks one story, and writes it.
 *
 * Structure comes from a tool schema rather than a "please return JSON"
 * instruction — the model reliably ignores the latter and writes prose.
 */
import { writeFileSync, readdirSync, readFileSync } from 'node:fs';

const DIR = 'src/content/articles';
const KEY = process.env.ANTHROPIC_API_KEY;
const AUTO_PUBLISH = process.env.AUTO_PUBLISH === 'true';
const BYLINE = process.env.BYLINE || 'Sport Spectator Staff';

if (!KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(0); }

const SECTIONS = [
  'dolphins', 'hurricanes', 'inter-miami', 'heat',
  'high-school-football', 'high-school-soccer', 'miami-soccer', 'gol-gala',
];

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

Search as much as you need. Then call the submit_article tool with the finished piece.
Do not write the article as a normal message — it only counts if it goes through the tool.`;

const SUBMIT_TOOL = {
  name: 'submit_article',
  description: 'Submit the finished article for publication. Call this exactly once, after researching.',
  input_schema: {
    type: 'object',
    properties: {
      title:   { type: 'string', description: 'Headline. Specific, not a teaser. No clickbait.' },
      dek:     { type: 'string', description: 'One or two sentences under the headline.' },
      section: { type: 'string', enum: SECTIONS, description: 'Which section this belongs in.' },
      slug:    { type: 'string', description: 'kebab-case URL slug, under 60 characters.' },
      tags:    { type: 'array', items: { type: 'string' }, description: '3-5 tags.' },
      body:    { type: 'string', description: 'Full article in markdown. No H1 — the title is separate. Use ## for subheads.' },
    },
    required: ['title', 'dek', 'section', 'slug', 'body'],
  },
};

const call = async (messages) => {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
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
      tools: [{ type: 'web_search_20250305', name: 'web_search' }, SUBMIT_TOOL],
      messages,
    }),
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 500)}`);
  return r.json();
};

let messages = [{
  role: 'user',
  content: `Today is ${new Date().toDateString()}. Search for today's Miami sports news across our beats, `
         + `pick the single story most worth a full piece, write it, and submit it with the tool.\n\n`
         + `Do NOT repeat any of these recent headlines:\n${recent.map((h) => `- ${h}`).join('\n')}`,
}];

let article = null;
const strayText = [];

for (let turn = 1; turn <= 6 && !article; turn++) {
  let data;
  try { data = await call(messages); }
  catch (e) { console.error(e.message); process.exit(0); }

  for (const b of data.content || []) {
    if (b.type === 'tool_use' && b.name === 'submit_article') article = b.input;
    if (b.type === 'text' && b.text.trim()) strayText.push(b.text.trim());
  }

  console.log(`turn ${turn}: stop_reason=${data.stop_reason}${article ? ' — article submitted' : ''}`);
  if (article) break;

  messages = [...messages, { role: 'assistant', content: data.content }];

  // pause_turn means the turn is unfinished; hand it back and let it resume.
  if (data.stop_reason === 'pause_turn') continue;

  // It stopped without calling the tool. Ask once, plainly.
  if (data.stop_reason === 'end_turn') {
    messages = [...messages, {
      role: 'user',
      content: 'Now call the submit_article tool with that piece. Do not reply with a message.',
    }];
  }
}

if (!article) {
  console.error('No article submitted after 6 turns.');
  if (strayText.length) {
    console.error('--- last message (first 1200 chars) ---');
    console.error(strayText[strayText.length - 1].slice(0, 1200));
  }
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
const slug = (article.slug || article.title)
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const esc = (s) => String(s).replace(/"/g, '\\"');

const front = [
  '---',
  `title: "${esc(article.title)}"`,
  `dek: "${esc(article.dek || '')}"`,
  `section: ${article.section}`,
  `author: ${BYLINE}`,
  `date: ${date}`,
  `draft: ${AUTO_PUBLISH ? 'false' : 'true'}`,
  `tags: [${(article.tags || []).map((t) => `"${esc(t)}"`).join(', ')}]`,
  '---',
  '',
].join('\n');

const file = `${DIR}/${date}-${slug}.md`;
writeFileSync(file, front + article.body.trim() + '\n');
console.log('Wrote', file);
console.log('Headline:', article.title);
