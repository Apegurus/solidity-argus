import { describe, it, expect } from "bun:test";
import { createHookGuard } from "./hook-system";
import type { HookName } from "./types";

describe("createHookGuard", () => {
  it("returns true for all hooks when disabledHooks is empty", () => {
    const isHookEnabled = createHookGuard([]);

    const allHooks: HookName[] = [
      "system-prompt",
      "compaction",
      "tool-tracking",
      "event",
      "knowledge-sync",
      "session-recovery",
      "tool-error-recovery",
      "context-window-monitor",
      "tool-output-truncator",
      "audit-continuation",
    ];

    allHooks.forEach((hook) => {
      expect(isHookEnabled(hook)).toBe(true);
    });
  });

  it("returns false for disabled hooks and true for enabled hooks", () => {
    const isHookEnabled = createHookGuard(["system-prompt", "event"]);

    expect(isHookEnabled("system-prompt")).toBe(false);
    expect(isHookEnabled("event")).toBe(false);
    expect(isHookEnabled("compaction")).toBe(true);
    expect(isHookEnabled("tool-tracking")).toBe(true);
    expect(isHookEnabled("knowledge-sync")).toBe(true);
    expect(isHookEnabled("session-recovery")).toBe(true);
    expect(isHookEnabled("tool-error-recovery")).toBe(true);
    expect(isHookEnabled("context-window-monitor")).toBe(true);
    expect(isHookEnabled("tool-output-truncator")).toBe(true);
    expect(isHookEnabled("audit-continuation")).toBe(true);
  });

  it("returns false for all hooks when all are disabled", () => {
    const isHookEnabled = createHookGuard([
      "system-prompt",
      "compaction",
      "tool-tracking",
      "event",
      "knowledge-sync",
      "session-recovery",
      "tool-error-recovery",
      "context-window-monitor",
      "tool-output-truncator",
      "audit-continuation",
    ]);

    const allHooks: HookName[] = [
      "system-prompt",
      "compaction",
      "tool-tracking",
      "event",
      "knowledge-sync",
      "session-recovery",
      "tool-error-recovery",
      "context-window-monitor",
      "tool-output-truncator",
      "audit-continuation",
    ];

    allHooks.forEach((hook) => {
      expect(isHookEnabled(hook)).toBe(false);
    });
  });

  it("handles single disabled hook correctly", () => {
    const isHookEnabled = createHookGuard(["system-prompt"]);

    expect(isHookEnabled("system-prompt")).toBe(false);
    expect(isHookEnabled("compaction")).toBe(true);
  });
});
