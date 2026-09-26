import type { AppState, DictationPhase } from "../../shared/types";

export type StateEvent =
  | { type: "START" }
  | { type: "STOP" }
  | { type: "CAPTURED" }
  | { type: "TRANSCRIBED"; refine: boolean }
  | { type: "REFINED" }
  | { type: "DELIVERED" }
  | { type: "FAIL"; message: string; retryable?: boolean }
  | { type: "NO_SPEECH" }
  | { type: "CANCEL" }
  | { type: "DISMISS" };

export const idleState = (): AppState => ({ phase: "idle", message: "Ready to dictate" });

const allowed: Record<DictationPhase, StateEvent["type"][]> = {
  idle: ["START"],
  recording: ["STOP", "CAPTURED", "FAIL", "NO_SPEECH", "CANCEL"],
  stopping: ["CAPTURED", "FAIL", "NO_SPEECH", "CANCEL"],
  transcribing: ["TRANSCRIBED", "FAIL", "NO_SPEECH", "CANCEL"],
  refining: ["REFINED", "FAIL", "CANCEL"],
  delivering: ["DELIVERED", "FAIL", "CANCEL"],
  recoverable: ["DISMISS", "CANCEL", "START"],
  error: ["DISMISS", "CANCEL", "START"],
};

export function transition(state: AppState, event: StateEvent): AppState {
  if (!allowed[state.phase].includes(event.type)) {
    throw new Error(`Invalid transition: ${state.phase} -> ${event.type}`);
  }

  switch (event.type) {
    case "START":
      return { phase: "recording", message: "Recording" };
    case "STOP":
      return { phase: "stopping", message: "Finishing recording…" };
    case "CAPTURED":
      return { phase: "transcribing", message: "Transcribing…" };
    case "TRANSCRIBED":
      return event.refine
        ? { phase: "refining", message: "Refining…" }
        : { phase: "delivering", message: "Pasting…" };
    case "REFINED":
      return { phase: "delivering", message: "Pasting…" };
    case "DELIVERED":
      return { phase: "recoverable", message: "Pasted", canCopyAgain: true };
    case "NO_SPEECH":
      return {
        phase: "error",
        message: "No speech detected",
        canRetry: true,
        canDiscard: true,
      };
    case "FAIL":
      return {
        phase: "error",
        message: event.message,
        canRetry: Boolean(event.retryable),
        canDiscard: true,
      };
    case "CANCEL":
    case "DISMISS":
      return idleState();
  }
}
