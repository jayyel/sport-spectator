import { defineConfig } from 'tinacms';

const branch = process.env.GITHUB_BRANCH || process.env.HEAD || 'main';

export default defineConfig({
  branch,
  clientId: process.env.NEXT_PUBLIC_TINA_CLIENT_ID!,
  token: process.env.TINA_TOKEN!,

  build: { outputFolder: 'admin', publicFolder: 'public' },
  media: { tina: { mediaRoot: 'images', publicFolder: 'public' } },

  schema: {
    collections: [
      {
        name: 'article',
        label: 'Articles',
        path: 'src/content/articles',
        format: 'md',
        defaultItem: () => ({
          author: 'John Lasak',
          date: new Date().toISOString(),
          draft: true,
        }),
        ui: {
          filename: {
            // Slug from the headline, so URLs stay readable.
            slugify: (values) =>
              (values?.title || 'untitled')
                .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60),
          },
        },
        fields: [
          { type: 'string', name: 'title', label: 'Headline', isTitle: true, required: true },
          { type: 'string', name: 'dek', label: 'Standfirst', ui: { component: 'textarea' } },
          {
            type: 'string', name: 'section', label: 'Section', required: true,
            options: [
              { value: 'dolphins', label: 'Dolphins' },
              { value: 'hurricanes', label: 'Hurricanes' },
              { value: 'inter-miami', label: 'Inter Miami' },
              { value: 'heat', label: 'Heat' },
              { value: 'high-school-football', label: 'High School Football' },
              { value: 'high-school-soccer', label: 'High School Soccer' },
              { value: 'miami-soccer', label: 'Miami Soccer' },
              { value: 'gol-gala', label: 'Gol Gala' },
            ],
          },
          { type: 'string', name: 'author', label: 'Byline' },
          { type: 'datetime', name: 'date', label: 'Publish date', required: true },
          {
            type: 'boolean', name: 'draft', label: 'Draft',
            description: 'Drafts are excluded from the build. Uncheck to publish.',
          },
          { type: 'image', name: 'image', label: 'Lead image' },
          { type: 'string', name: 'imageCredit', label: 'Photo credit' },
          { type: 'string', name: 'tags', label: 'Tags', list: true },
          { type: 'rich-text', name: 'body', label: 'Body', isBody: true },
        ],
      },
    ],
  },
});
