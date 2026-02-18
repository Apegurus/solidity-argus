import { describe, it, expect } from "bun:test";
import type { PluginState } from "./plugin-state";
import type { ArgusConfig } from "../config/types";
import type { Managers } from "../managers/types";

describe("PluginState type shape", () => {
  it("should compile with correct interface structure", () => {
    const mockConfig: ArgusConfig = {
      agents: {
        argus: { model: "anthropic/claude-opus-4-6" },
        sentinel: { model: "anthropic/claude-sonnet-4-6" },
        pythia: { model: "anthropic/claude-sonnet-4-6" },
        scribe: { model: "anthropic/claude-sonnet-4-5" },
      },
      tools: {
        slitherPath: "/usr/local/bin/slither",
        forgePath: "/usr/local/bin/forge",
      },
      knowledge: {
        scvd: {
          enabled: true,
          apiUrl: "https://api.scvd.dev",
        },
        autoSync: true,
      },
      reporting: {
        format: "markdown",
        severityThreshold: "low",
        gasAnalysis: false,
      },
      solodit: {
        enabled: true,
        port: 3000,
      },
      disabled_hooks: [],
      hooks: {},
      cli: {},
      background: {
        max_concurrent: 3,
      },
    };

    const mockManagers: Managers = {
      backgroundManager: {
        dispatch: () => "task-1",
        cancel: () => {},
        getResult: async () => ({}),
        onComplete: () => {},
        getActiveCount: () => 0,
      },
      auditStateManager: {
        load: async () => null,
        save: async () => {},
        get: () => null,
        update: async () => {},
        reset: async () => {},
      },
    };

    const pluginState: PluginState = {
      config: mockConfig,
      projectDir: "/path/to/project",
      managers: mockManagers,
      isHookEnabled: (name: string) => true,
    };

    expect(pluginState.config).toBeDefined();
    expect(pluginState.projectDir).toBe("/path/to/project");
    expect(pluginState.managers).toBeDefined();
    expect(typeof pluginState.isHookEnabled).toBe("function");
  });

  it("should have all required properties", () => {
    type PluginStateKeys = keyof PluginState;
    const requiredKeys: PluginStateKeys[] = [
      "config",
      "projectDir",
      "managers",
      "isHookEnabled",
    ];

    requiredKeys.forEach((key) => {
      expect(key).toBeDefined();
    });
  });
});
