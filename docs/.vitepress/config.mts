import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitepress";

const versionSource = readFileSync(resolve(import.meta.dirname, "../../gear_sdk/version.py"), "utf8");
const version = versionSource.match(/__version__\s*=\s*["']([^"']+)["']/)?.[1] ?? "dev";
const base = process.env.VITEPRESS_BASE ?? "/";

export default defineConfig({
  lang: "en-US",
  title: "GEAR Framework",
  description: "Design multi-agent systems once, then generate implementations for multiple agent frameworks.",
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", type: "image/png", href: `${base}assets/GEAR-logo.png` }],
    ["meta", { name: "theme-color", content: "#0b2948" }]
  ],
  themeConfig: {
    gearVersion: version,
    logo: "/assets/GEAR-logo.png",
    siteTitle: "GEAR",
    nav: [
      { text: "Guide", link: "/guide" },
      { text: "YAML Reference", link: "/yaml-reference" },
      { text: "Studio", link: "/studio" },
      { text: "SDK & API", link: "/sdk-cli" },
      {
        text: `v${version}`,
        items: [
          { text: "Release notes", link: "/changelog" },
          { text: "Roadmap", link: "/ROADMAP" }
        ]
      }
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Overview", link: "/guide" },
          { text: "Installation", link: "/installation" },
          { text: "GEAR Studio", link: "/studio" }
        ]
      },
      {
        text: "Configuration",
        items: [
          { text: "YAML overview", link: "/yaml-reference" },
          { text: "Project structure", link: "/project-model" },
          { text: "Agents", link: "/yaml-agent" },
          { text: "Modules", link: "/yaml-module" },
          { text: "Workflow", link: "/yaml-workflow" },
          { text: "Complete examples", link: "/yaml-examples" }
        ]
      },
      {
        text: "Conversion and execution",
        items: [
          { text: "Framework compatibility", link: "/yaml-compatibility" },
          { text: "Conversion", link: "/conversion" },
          { text: "Connectors", link: "/connectors" },
          { text: "Build and execution", link: "/builds-execution" }
        ]
      },
      {
        text: "Developer reference",
        items: [
          { text: "SDK and CLI", link: "/sdk-cli" },
          { text: "HTTP API", link: "/api" },
          { text: "Architecture", link: "/ARCHITECTURE" }
        ]
      },
      {
        text: "Project",
        items: [
          { text: "FAQ", link: "/faq" },
          { text: "Roadmap", link: "/ROADMAP" },
          { text: "Release notes", link: "/changelog" }
        ]
      }
    ],
    search: { provider: "local" },
    socialLinks: [
      { icon: "github", link: "https://github.com/brellsanwouo/gear-framework" }
    ],
    editLink: {
      pattern: "https://github.com/brellsanwouo/gear-framework/edit/main/docs/:path",
      text: "Edit this page on GitHub"
    },
    lastUpdated: { text: "Last updated" },
    outline: { label: "On this page", level: [2, 3] },
    docFooter: { prev: "Previous page", next: "Next page" },
    footer: {
      message: "GEAR Framework — portable multi-agent system design.",
      copyright: "Released under the MIT License."
    }
  }
});
