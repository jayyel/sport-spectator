import { getCollection } from 'astro:content';

export async function GET() {
  const posts = (await getCollection('articles', ({ data }) => !data.draft))
    .sort((a, b) => b.data.date - a.data.date)
    .slice(0, 12)
    .map((p) => ({
      slug: p.id,
      url: `/articles/${p.id}/`,
      title: p.data.title,
      dek: p.data.dek ?? '',
      section: p.data.section,
      author: p.data.author,
      date: p.data.date.toISOString(),
      image: p.data.image ?? null,
    }));

  return new Response(JSON.stringify({ updated: new Date().toISOString(), posts }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
  });
}
