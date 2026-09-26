const MODIFIERS = new Map<string, string>([
  ["command", "Command"],
  ["cmd", "Command"],
  ["control", "Control"],
  ["ctrl", "Control"],
  ["commandorcontrol", "CommandOrControl"],
  ["cmdorctrl", "CommandOrControl"],
  ["alt", "Alt"],
  ["option", "Option"],
  ["altgr", "AltGr"],
  ["shift", "Shift"],
  ["super", "Super"],
  ["meta", "Super"],
]);

const MODIFIER_ORDER = ["Command", "CommandOrControl", "Control", "Alt", "AltGr", "Option", "Shift", "Super"];

const NAMED_KEYS = new Map<string, string>([
  ["plus", "Plus"],
  ["space", "Space"],
  ["tab", "Tab"],
  ["capslock", "Capslock"],
  ["numlock", "Numlock"],
  ["scrolllock", "Scrolllock"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["insert", "Insert"],
  ["return", "Return"],
  ["enter", "Return"],
  ["up", "Up"],
  ["down", "Down"],
  ["left", "Left"],
  ["right", "Right"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
  ["escape", "Escape"],
  ["esc", "Escape"],
  ["volumeup", "VolumeUp"],
  ["volumedown", "VolumeDown"],
  ["volumemute", "VolumeMute"],
  ["medianexttrack", "MediaNextTrack"],
  ["mediaprevioustrack", "MediaPreviousTrack"],
  ["mediastop", "MediaStop"],
  ["mediaplaypause", "MediaPlayPause"],
  ["printscreen", "PrintScreen"],
  ...Array.from({ length: 10 }, (_, index) => [`num${index}`, `num${index}`] as [string, string]),
  ["numdec", "numdec"],
  ["numadd", "numadd"],
  ["numsub", "numsub"],
  ["nummult", "nummult"],
  ["numdiv", "numdiv"],
]);

const PUNCTUATION_KEYS = new Set([
  ")", "!", "@", "#", "$", "%", "^", "&", "*", "(", ":", ";", "=", "<", ",", "_", "-",
  ">", ".", "?", "/", "~", "`", "{", "]", "[", "|", "\\", "}", "\"", "'",
]);

export class InvalidHotkeyError extends Error {}

export type HotkeySetting = "hotkey" | "practiceHotkey" | "cancelHotkey";

export const HOTKEY_LABELS: Record<HotkeySetting, string> = {
  hotkey: "Start/Stop dictation keys",
  practiceHotkey: "Practice activation keys",
  cancelHotkey: "Cancelation keys",
};

export function normalizeConfiguredHotkeys(values: Record<HotkeySetting, unknown>): Record<HotkeySetting, string> {
  const normalized = {
    hotkey: normalizeHotkey(values.hotkey),
    practiceHotkey: normalizeHotkey(values.practiceHotkey),
    cancelHotkey: normalizeHotkey(values.cancelHotkey),
  };
  const assigned = new Map<string, HotkeySetting>();
  for (const setting of Object.keys(normalized) as HotkeySetting[]) {
    const existing = assigned.get(normalized[setting]);
    if (existing) {
      throw new InvalidHotkeyError(
        `${normalized[setting]} is already assigned to ${HOTKEY_LABELS[existing]}`,
      );
    }
    assigned.set(normalized[setting], setting);
  }
  return normalized;
}

export function normalizeHotkey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new InvalidHotkeyError("Enter a shortcut before saving");
  const parts = value.split("+").map((part) => part.trim());
  if (parts.some((part) => !part)) throw new InvalidHotkeyError(`The shortcut ${JSON.stringify(value.trim())} is invalid`);

  const modifiers = new Set<string>();
  let key: string | undefined;
  for (const part of parts) {
    const lower = part.toLowerCase();
    const modifier = MODIFIERS.get(lower);
    if (modifier) {
      if (modifiers.has(modifier)) throw new InvalidHotkeyError(`The shortcut ${JSON.stringify(value.trim())} repeats a modifier`);
      modifiers.add(modifier);
      continue;
    }
    if (key) throw new InvalidHotkeyError(`The shortcut ${JSON.stringify(value.trim())} must contain one key`);
    key = normalizeKey(part, lower);
  }
  if (!key) throw new InvalidHotkeyError(`The shortcut ${JSON.stringify(value.trim())} must contain one key`);
  if (modifiers.has("Command")) throw new InvalidHotkeyError("Use Control instead of Command on Ubuntu");
  if (modifiers.has("Option")) throw new InvalidHotkeyError("Use Alt instead of Option on Ubuntu");

  const normalized = [...modifiers].sort(
    (left, right) => MODIFIER_ORDER.indexOf(left) - MODIFIER_ORDER.indexOf(right),
  ).concat(key).join("+");
  return normalized;
}

export function hotkeysEquivalent(left: string, right: string): boolean {
  try {
    return normalizeHotkey(left) === normalizeHotkey(right);
  } catch {
    return false;
  }
}

function normalizeKey(original: string, lower: string): string {
  if (/^[a-z]$/i.test(original)) return original.toUpperCase();
  if (/^[0-9]$/.test(original)) return original;
  const functionKey = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(original);
  if (functionKey) return `F${functionKey[1]}`;
  const named = NAMED_KEYS.get(lower);
  if (named) return named;
  if (original.length === 1 && PUNCTUATION_KEYS.has(original)) return original;
  throw new InvalidHotkeyError(`The key ${JSON.stringify(original)} is not a valid Electron accelerator key`);
}
