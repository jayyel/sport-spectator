// tina/config.ts
import { defineConfig } from "tinacms";
var branch = process.env.GITHUB_BRANCH || process.env.HEAD || "main";
var config_default = defineConfig({
  branch,
  // Client ID is public by design — it identifies the project, it doesn't grant access.
  // The token is what's sensitive, so that stays in an environment variable.
  clientId: "d1cf7cdd-97f4-4678-bfd5-643329e023ab",
  token: process.env.TINA_TOKEN,
  // Builds the editor into public/admin, which Astro then copies to dist/admin.
  build: { outputFolder: "admin", publicFolder: "public" },
  media: { tina: { mediaRoot: "images", publicFolder: "public" } },
  schema: {
    collections: [
      {
        name: "article",
        label: "Articles",
        path: "src/content/articles",
        format: "md",
        defaultItem: () => ({
          author: "John Lasak",
          date: (/* @__PURE__ */ new Date()).toISOString(),
          draft: true
        }),
        ui: {
          filename: {
            slugify: (values) => (values?.title || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
          }
        },
        fields: [
          { type: "string", name: "title", label: "Headline", isTitle: true, required: true },
          { type: "string", name: "dek", label: "Standfirst", ui: { component: "textarea" } },
          {
            type: "string",
            name: "section",
            label: "Section",
            required: true,
            options: [
              { value: "dolphins", label: "Dolphins" },
              { value: "hurricanes", label: "Hurricanes" },
              { value: "inter-miami", label: "Inter Miami" },
              { value: "heat", label: "Heat" },
              { value: "high-school-football", label: "High School Football" },
              { value: "high-school-soccer", label: "High School Soccer" },
              { value: "miami-soccer", label: "Miami Soccer" },
              { value: "gol-gala", label: "Gol Gala" }
            ]
          },
          { type: "string", name: "author", label: "Byline" },
          { type: "datetime", name: "date", label: "Publish date", required: true },
          {
            type: "boolean",
            name: "draft",
            label: "Draft",
            description: "Drafts are excluded from the build. Uncheck to publish."
          },
          { type: "image", name: "image", label: "Lead image" },
          { type: "string", name: "imageCredit", label: "Photo credit" },
          { type: "string", name: "tags", label: "Tags", list: true },
          { type: "rich-text", name: "body", label: "Body", isBody: true }
        ]
      }
    ]
  }
});
export {
  config_default as default
};
