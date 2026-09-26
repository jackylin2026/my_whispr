import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RenderedMarkdown } from "../src/renderer/src/RenderedMarkdown";

describe("coaching Markdown", () => {
  it("renders headings, emphasis, explicit breaks, and GFM tables", () => {
    const markdown = `## Quick Coaching Guide

**Overall score:** 77<br>

| Word | What to watch |
| --- | --- |
| **big** | Shape the sound |`;
    const html = renderToStaticMarkup(createElement(RenderedMarkdown, null, markdown));
    expect(html).toContain("<h2>Quick Coaching Guide</h2>");
    expect(html).toContain("<strong>Overall score:</strong>");
    expect(html).toContain("<br/>");
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>big</strong>");
  });
});
