import { test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { loadArgusConfig } from "./plugin-config";
import type { ArgusConfig } from "./plugin-config";
import { ZodError } from "zod";

// Test fixtures
const testDir = "/tmp/argus-config-test";

beforeEach(() => {
  // Clean up before each test
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  // Clean up after each test
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

test("loadArgusConfig returns default config when no file exists", () => {
  const config = loadArgusConfig(testDir);

  expect(config).toBeDefined();
  expect(config.agents).toBeDefined();
  expect(config.agents.argus).toEqual({});
  expect(config.agents.sentinel).toEqual({});
  expect(config.agents.pythia).toEqual({});
  expect(config.agents.scribe).toEqual({});
  expect(config.tools).toEqual({});
  expect(config.knowledge).toBeDefined();
  expect(config.knowledge.scvd).toBeDefined();
  expect(config.knowledge.scvd.enabled).toBe(true);
  expect(config.knowledge.scvd.apiUrl).toBe("https://api.scvd.dev");
  expect(config.knowledge.autoSync).toBe(true);
  expect(config.reporting).toBeDefined();
  expect(config.reporting.format).toBe("markdown");
  expect(config.reporting.severityThreshold).toBe("low");
  expect(config.reporting.gasAnalysis).toBe(false);
  expect(config.solodit).toBeDefined();
  expect(config.solodit.enabled).toBe(true);
});

test("loadArgusConfig merges partial config with defaults", () => {
  const configDir = join(testDir, ".opencode");
  mkdirSync(configDir, { recursive: true });

  const partialConfig = {
    agents: {
      argus: {
        model: "anthropic/claude-opus-4-6",
      },
    },
    reporting: {
      gasAnalysis: true,
    },
  };

  writeFileSync(
    join(configDir, "opencode-argus.jsonc"),
    JSON.stringify(partialConfig)
  );

  const config = loadArgusConfig(testDir);

  // Check merged values
  expect(config.agents.argus.model).toBe("anthropic/claude-opus-4-6");
  expect(config.agents.sentinel).toEqual({});
  expect(config.reporting.gasAnalysis).toBe(true);
  expect(config.reporting.format).toBe("markdown");
  expect(config.reporting.severityThreshold).toBe("low");
  expect(config.knowledge.scvd.enabled).toBe(true);
});

test("loadArgusConfig handles JSONC comments", () => {
  const configDir = join(testDir, ".opencode");
  mkdirSync(configDir, { recursive: true });

  const jsonc = `{
    // This is a comment
    "agents": {
      "argus": {
        "model": "anthropic/claude-opus-4-6" // inline comment
      }
    },
    /* block comment */
    "reporting": {
      "format": "markdown"
    }
  }`;

  writeFileSync(join(configDir, "opencode-argus.jsonc"), jsonc);

  const config = loadArgusConfig(testDir);

  expect(config.agents.argus.model).toBe("anthropic/claude-opus-4-6");
  expect(config.reporting.format).toBe("markdown");
});

test("loadArgusConfig throws ZodError for invalid config type", () => {
  const configDir = join(testDir, ".opencode");
  mkdirSync(configDir, { recursive: true });

  const invalidConfig = {
    agents: {
      argus: {
        model: 123, // Wrong type - should be string
      },
    },
  };

  writeFileSync(
    join(configDir, "opencode-argus.jsonc"),
    JSON.stringify(invalidConfig)
  );

  expect(() => loadArgusConfig(testDir)).toThrow(ZodError);
});

test("loadArgusConfig throws ZodError with descriptive path for nested invalid field", () => {
  const configDir = join(testDir, ".opencode");
  mkdirSync(configDir, { recursive: true });

  const invalidConfig = {
    knowledge: {
      scvd: {
        enabled: "yes", // Wrong type - should be boolean
      },
    },
  };

  writeFileSync(
    join(configDir, "opencode-argus.jsonc"),
    JSON.stringify(invalidConfig)
  );

  try {
    loadArgusConfig(testDir);
    expect.unreachable("Should have thrown ZodError");
  } catch (error) {
    if (error instanceof ZodError) {
      const errorPath = error.issues[0]!.path.join(".");
      expect(errorPath).toContain("scvd");
      expect(errorPath).toContain("enabled");
    } else {
      throw error;
    }
  }
});

test("loadArgusConfig validates reporting.severityThreshold enum", () => {
  const configDir = join(testDir, ".opencode");
  mkdirSync(configDir, { recursive: true });

  const invalidConfig = {
    reporting: {
      severityThreshold: "invalid-severity",
    },
  };

  writeFileSync(
    join(configDir, "opencode-argus.jsonc"),
    JSON.stringify(invalidConfig)
  );

  expect(() => loadArgusConfig(testDir)).toThrow(ZodError);
});

test("loadArgusConfig validates reporting.format enum", () => {
  const configDir = join(testDir, ".opencode");
  mkdirSync(configDir, { recursive: true });

  const invalidConfig = {
    reporting: {
      format: "pdf", // Only "markdown" is allowed
    },
  };

  writeFileSync(
    join(configDir, "opencode-argus.jsonc"),
    JSON.stringify(invalidConfig)
  );

  expect(() => loadArgusConfig(testDir)).toThrow(ZodError);
});

test("loadArgusConfig accepts valid full config", () => {
  const configDir = join(testDir, ".opencode");
  mkdirSync(configDir, { recursive: true });

  const fullConfig = {
    agents: {
      argus: { model: "anthropic/claude-opus-4-6" },
      sentinel: { model: "anthropic/claude-sonnet-4-6" },
      pythia: { model: "anthropic/claude-sonnet-4-6" },
      scribe: { model: "anthropic/claude-sonnet-4-5-20250929" },
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
      customSkillsDir: "/path/to/skills",
    },
    reporting: {
      format: "markdown",
      severityThreshold: "high",
      gasAnalysis: true,
    },
    solodit: {
      enabled: true,
    },
  };

  writeFileSync(
    join(configDir, "opencode-argus.jsonc"),
    JSON.stringify(fullConfig)
  );

  const config = loadArgusConfig(testDir);

  expect(config.agents.argus.model).toBe("anthropic/claude-opus-4-6");
  expect(config.agents.sentinel.model).toBe("anthropic/claude-sonnet-4-6");
  expect(config.tools.slitherPath).toBe("/usr/local/bin/slither");
  expect(config.tools.forgePath).toBe("/usr/local/bin/forge");
  expect(config.knowledge.customSkillsDir).toBe("/path/to/skills");
  expect(config.reporting.severityThreshold).toBe("high");
  expect(config.reporting.gasAnalysis).toBe(true);
});

test("loadArgusConfig returns ArgusConfig type", () => {
  const config = loadArgusConfig(testDir);

  // Type check - this is a compile-time check but we verify structure
  expect(config).toHaveProperty("agents");
  expect(config).toHaveProperty("tools");
  expect(config).toHaveProperty("knowledge");
  expect(config).toHaveProperty("reporting");
  expect(config).toHaveProperty("solodit");
});

test("loadArgusConfig handles empty JSONC file", () => {
  const configDir = join(testDir, ".opencode");
  mkdirSync(configDir, { recursive: true });

  writeFileSync(join(configDir, "opencode-argus.jsonc"), "{}");

  const config = loadArgusConfig(testDir);

  // Should merge empty object with defaults
  expect(config.knowledge.scvd.enabled).toBe(true);
  expect(config.reporting.format).toBe("markdown");
});

test("loadArgusConfig handles malformed JSON", () => {
  const configDir = join(testDir, ".opencode");
  mkdirSync(configDir, { recursive: true });

  writeFileSync(join(configDir, "opencode-argus.jsonc"), "{ invalid json }");

  expect(() => loadArgusConfig(testDir)).toThrow();
});
