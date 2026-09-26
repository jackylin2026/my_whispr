import { describe, expect, it } from "vitest";
import { idleState, transition } from "../src/main/core/state-machine";

describe("dictation state machine", () => {
  it("runs the local, unrefined happy path", () => {
    let state = transition(idleState(), { type: "START" });
    expect(state.phase).toBe("recording");
    state = transition(state, { type: "STOP" });
    expect(state.phase).toBe("stopping");
    state = transition(state, { type: "CAPTURED" });
    expect(state.phase).toBe("transcribing");
    state = transition(state, { type: "TRANSCRIBED", refine: false });
    expect(state.phase).toBe("delivering");
    state = transition(state, { type: "DELIVERED" });
    expect(state).toMatchObject({ phase: "recoverable", canCopyAgain: true });
    expect(transition(state, { type: "DISMISS" }).phase).toBe("idle");
  });

  it("adds refinement only when selected", () => {
    let state = transition(idleState(), { type: "START" });
    state = transition(state, { type: "CAPTURED" });
    state = transition(state, { type: "TRANSCRIBED", refine: true });
    expect(state.phase).toBe("refining");
    expect(transition(state, { type: "REFINED" }).phase).toBe("delivering");
  });

  it("rejects impossible transitions", () => {
    expect(() => transition(idleState(), { type: "DELIVERED" })).toThrow("Invalid transition");
  });

  it("offers retry and discard for silence", () => {
    const recording = transition(idleState(), { type: "START" });
    expect(transition(recording, { type: "NO_SPEECH" })).toMatchObject({
      phase: "error",
      canRetry: true,
      canDiscard: true,
    });
  });
});
