const fs = require("fs");
const path = require("path");
const MarkdownIt = require("markdown-it");
const juice = require("juice");
const markdownItAlert = require("./markdown-it-alert");

const basicSource = fs.readFileSync(path.join(__dirname, "../template/basic.js"), "utf8");
const basic = basicSource.match(/export default `([\s\S]*)`;\s*$/)[1];

const render = (source) => new MarkdownIt().use(markdownItAlert).render(source);

describe("markdown-it-alert", () => {
  test.each(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"])("renders the %s alert type", (type) => {
    const html = render(`> [!${type}] Alert body`);

    expect(html).toContain(`class="markdown-alert markdown-alert-${type.toLowerCase()}"`);
    expect(html).toContain(`<strong class="markdown-alert-title">${type}</strong>`);
    expect(html).toContain("Alert body");
    expect(html).not.toContain(`[!${type}]`);
  });

  it("matches alert types case-insensitively", () => {
    expect(render("> [!warning] Be careful")).toContain("markdown-alert-warning");
  });

  it("keeps unknown types as ordinary blockquotes", () => {
    const html = render("> [!CUSTOM] Keep this marker");

    expect(html).toContain("<blockquote>");
    expect(html).toContain("[!CUSTOM] Keep this marker");
    expect(html).not.toContain("markdown-alert");
  });

  it("keeps multiline markdown inside the alert body", () => {
    const html = render("> [!NOTE]\n> Supports **Markdown** and another line.");

    expect(html).toContain("markdown-alert-note");
    expect(html).toContain("<strong>Markdown</strong>");
    expect(html).toContain("another line");
  });

  it("inlines alert styles for WeChat output", () => {
    const html = `<section id="nice">${render("> [!IMPORTANT] Inline me")}</section>`;
    const inlined = juice.inlineContent(html, basic);

    expect(inlined).toMatch(/class="markdown-alert markdown-alert-important"[^>]*style="[^"]*border-left:/);
    expect(inlined).toMatch(/class="markdown-alert-title"[^>]*style="[^"]*(font-weight: bold|font-weight:bold)/);
  });
});
