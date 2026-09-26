import { describe, expect, it } from "vitest";
import { azureCancellationError } from "../src/main/azure-speech-client";

describe("Azure Speech cancellation", () => {
  it("treats end-of-stream as successful completion", () => {
    expect(azureCancellationError(1, 0, "")).toBeUndefined();
  });

  it("preserves actual cancellation diagnostics", () => {
    expect(azureCancellationError(0, 4, "connection failed")?.message).toContain("connection failed");
  });
});
