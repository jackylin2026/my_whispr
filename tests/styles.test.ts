import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("model selection contrast", () => {
  it("defines selected text colors and light-theme selected colors", async () => {
    const css = await readFile("src/renderer/src/styles.css", "utf8");
    const dark = css.match(/^:root\s*\{([^}]*)\}/m)?.[1] ?? "";
    const light = css.match(/@media \(prefers-color-scheme: light\)[\s\S]*?:root\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(css).toContain("--selected-text:");
    expect(css).toContain("--selected-muted:");
    expect(css).toMatch(/\.model\.selected\s+strong\s*\{[^}]*var\(--selected-text\)/s);
    for (const theme of [dark, light]) {
      const background = variable(theme, "selected-bg");
      expect(contrast(variable(theme, "selected-text"), background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(variable(theme, "selected-muted"), background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("settings layout", () => {
  it("keeps the status line fixed while only the active tab panel scrolls", async () => {
    const css = await readFile("src/renderer/src/styles.css", "utf8");

    expect(css).toMatch(/\.settings\s*\{[^}]*height:\s*100vh[^}]*display:\s*flex[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.tab-panel-card\s*\{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.settings-status\s*\{[^}]*flex:\s*0 0 auto/s);
    expect(css).not.toMatch(/\.settings-status\s*\{[^}]*position:\s*sticky/s);
  });

  it("allows horizontal tab scrolling without a vertical scrollbar", async () => {
    const css = await readFile("src/renderer/src/styles.css", "utf8");
    const tabs = css.match(/\.settings-tabs\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(tabs).toMatch(/overflow-x:\s*auto/);
    expect(tabs).toMatch(/overflow-y:\s*hidden/);
  });
});

function variable(block: string, name: string): string {
  const value = block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
