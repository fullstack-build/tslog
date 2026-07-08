import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://tslog.js.org",
  integrations: [
    starlight({
      title: "tslog",
      description:
        "Beautiful logging experience for TypeScript and JavaScript.",
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
      // Soft-wrap long code lines so blocks fit the content column instead of
      // scrolling horizontally; wrapped continuations keep the line's indent.
      expressiveCode: {
        defaultProps: {
          wrap: true,
          preserveIndent: true,
        },
      },
      components: {
        PageTitle: "./src/overrides/PageTitle.astro",
        Header: "./src/overrides/Header.astro",
      },
      customCss: ["./src/styles/custom.css"],
      head: [
        // Override <title> (replaces Starlight's auto-generated "{page} | {site}" title)
        {
          tag: "title",
          content:
            "tslog: Beautiful logging experience for TypeScript and JavaScript",
        },
        // Default to the dark, terminal-style theme.
        {
          tag: "script",
          content: `document.documentElement.dataset.theme="dark";try{localStorage.setItem("starlight-theme","dark")}catch(e){}`,
        },
      ],
    }),
  ],
});
