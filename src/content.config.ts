import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    dek: z.string().optional(),
    section: z.enum([
      'dolphins', 'hurricanes', 'inter-miami', 'heat',
      'high-school-football', 'high-school-soccer', 'miami-soccer', 'gol-gala',
    ]),
    author: z.string().default('John Lasak'),
    date: z.coerce.date(),
    draft: z.boolean().default(false),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    imageCredit: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { articles };
