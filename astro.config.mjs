import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://thesportspectator.com',
  // public/ is copied verbatim, so the existing homepage is untouched.
  // Astro only generates /articles/* and the section pages.
  build: { format: 'directory' },
});
