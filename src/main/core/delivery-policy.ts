import type { PasteShortcutMode } from "../../shared/types";

const TERMINAL_CLASSES = new Set([
  "alacritty",
  "com.mitchellh.ghostty",
  "gnome-terminal",
  "gnome-terminal-server",
  "kitty",
  "konsole",
  "org.gnome.console",
  "org.gnome.terminal",
  "org.gnome.terminal-server",
  "org.wezfurlong.wezterm",
  "terminator",
  "tilix",
  "wezterm-gui",
  "xfce4-terminal",
  "xterm",
]);

export type PasteShortcut = "ctrl+v" | "ctrl+shift+v";

export function parseWindowClass(property: string): string | undefined {
  const classes = [...property.matchAll(/"([^"]+)"/g)];
  return classes.at(-1)?.[1];
}

export function pasteShortcutFor(
  mode: PasteShortcutMode,
  windowClass?: string,
): PasteShortcut {
  if (mode === "standard") return "ctrl+v";
  if (mode === "terminal") return "ctrl+shift+v";
  return windowClass && TERMINAL_CLASSES.has(windowClass.trim().toLowerCase())
    ? "ctrl+shift+v"
    : "ctrl+v";
}

export function shouldRestoreClipboard(currentText: string, deliveredText: string): boolean {
  return currentText === deliveredText;
}
