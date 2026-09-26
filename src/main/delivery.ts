import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clipboard, ClipboardItem } from "electron";
import type { PasteShortcutMode } from "../shared/types";
import {
  parseWindowClass,
  pasteShortcutFor,
  shouldRestoreClipboard,
} from "./core/delivery-policy";

const run = promisify(execFile);

export type ClipboardSnapshot = Electron.ClipboardItem[];
export interface DeliveryTarget {
  windowId: string;
  windowClass?: string;
}

export class DeliveryService {
  async activeTarget(): Promise<DeliveryTarget | null> {
    try {
      const windowId = (await run("/usr/bin/xdotool", ["getactivewindow"])).stdout.trim();
      if (!windowId) return null;
      const windowClass = await this.windowClass(windowId);
      return { windowId, windowClass: windowClass || undefined };
    } catch {
      return null;
    }
  }

  async deliver(
    target: DeliveryTarget | null,
    text: string,
    pasteShortcutMode: PasteShortcutMode,
  ): Promise<boolean> {
    const snapshot = await snapshotClipboard();
    await clipboard.writeText(text);

    if (!target || !(await this.windowExists(target.windowId))) {
      if (shouldRestoreClipboard(await clipboard.readText(), text)) await clipboard.write(snapshot);
      return false;
    }
    const windowClass =
      target.windowClass ||
      (pasteShortcutMode === "automatic" ? await this.windowClass(target.windowId) : undefined);
    const shortcut = pasteShortcutFor(pasteShortcutMode, windowClass);

    try {
      await run("/usr/bin/xdotool", ["windowactivate", "--sync", target.windowId]);
      await new Promise((resolve) => setTimeout(resolve, 60));
      await run("/usr/bin/xdotool", ["key", "--clearmodifiers", shortcut]);
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (shouldRestoreClipboard(await clipboard.readText(), text)) await clipboard.write(snapshot);
      return true;
    } catch {
      if (shouldRestoreClipboard(await clipboard.readText(), text)) await clipboard.write(snapshot);
      return false;
    }
  }

  async copy(text: string): Promise<void> {
    await clipboard.writeText(text);
  }

  async selectedText(): Promise<string> {
    return clipboard.selection.readText();
  }

  private async windowExists(window: string): Promise<boolean> {
    try {
      await run("/usr/bin/xdotool", ["getwindowname", window]);
      return true;
    } catch {
      return false;
    }
  }

  private async windowClass(window: string): Promise<string> {
    try {
      const property = (await run("/usr/bin/xprop", ["-id", window, "WM_CLASS"])).stdout;
      return parseWindowClass(property) ?? "";
    } catch {
      return "";
    }
  }
}

async function snapshotClipboard(): Promise<ClipboardSnapshot> {
  const current = await clipboard.read();
  return Promise.all(
    current.map(async (item) => {
      const entries = await Promise.all(
        item.types.map(async (type) => [type, await item.getType(type)] as const),
      );
      return new ClipboardItem(Object.fromEntries(entries));
    }),
  );
}
