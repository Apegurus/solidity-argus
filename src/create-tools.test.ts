import { describe, expect, it } from "bun:test"
import type { ToolDefinition } from "@opencode-ai/plugin"
import type { ArgusConfig } from "./config/types"
import { createTools, withResultCapture } from "./create-tools"
import { createToolResultCache, type ToolResultCache } from "./shared/tool-result-cache"

const baseConfig: ArgusConfig = {
  agents: {
    argus: {},
    sentinel: {},
    pythia: {},
    auditSpecialist: {},
    scribe: {},
    themis: {},
  },
  tools: {},
  knowledge: {
    scvd: {
      enabled: true,
      apiUrl: "https://api.scvd.dev",
    },
    autoSync: true,
    skillPrecedence: "bundled-first",
  },
  reporting: {
    confidenceThreshold: 80,
    format: "markdown",
    severityThreshold: "low",
    gasAnalysis: false,
    output_dir: ".opencode/reports/",
  },
  solodit: {
    enabled: true,
    port: 54173,
  },
  disabled_hooks: [],
  hooks: {},
  cli: {},
  background: {
    max_concurrent: 3,
  },
}

describe("createTools", () => {
  it("registers exactly 16 tools when solodit is enabled", () => {
    const config: ArgusConfig = {
      ...baseConfig,
      solodit: { enabled: true, port: 54173 },
    }
    const tools = createTools(config)
    const toolNames = Object.keys(tools).sort()

    expect(toolNames).toHaveLength(16)
    expect(toolNames).toEqual([
      "argus_analyze_contract",
      "argus_check_patterns",
      "argus_forge_coverage",
      "argus_forge_fuzz",
      "argus_forge_test",
      "argus_gas_analysis",
      "argus_generate_report",
      "argus_persist_deduped",
      "argus_proxy_detection",
      "argus_read_findings",
      "argus_record_finding",
      "argus_skill_load",
      "argus_slither_analyze",
      "argus_solodit_search",
      "argus_sync_knowledge",
      "argus_themis_disposition",
    ])
  })

  it("registers 15 tools when solodit is disabled", () => {
    const config: ArgusConfig = {
      ...baseConfig,
      solodit: { enabled: false, port: 54173 },
    }
    const tools = createTools(config)

    expect(Object.keys(tools)).toHaveLength(15)
    expect(tools.argus_solodit_search).toBeUndefined()
  })
})

function fakeTool(executeResult: string): ToolDefinition {
  return {
    description: "fake",
    args: {},
    execute: async () => executeResult,
  } as unknown as ToolDefinition
}

function fakeContext(sessionID: string): Parameters<ToolDefinition["execute"]>[1] {
  return { sessionID } as unknown as Parameters<ToolDefinition["execute"]>[1]
}

describe("withResultCapture", () => {
  it("writes the tool result to the cache under (sessionId, name)", async () => {
    const cache = createToolResultCache()
    const wrapped = withResultCapture("argus_check_patterns", fakeTool("FULL_RESULT"), cache)

    const out = await wrapped.execute({} as never, fakeContext("ses_9"))

    expect(out).toBe("FULL_RESULT")
    expect(cache.take("ses_9", "argus_check_patterns")).toBe("FULL_RESULT")
  })

  it("returns the tool result even when the cache write throws", async () => {
    const throwingCache: ToolResultCache = {
      set() {
        throw new Error("boom")
      },
      take: () => undefined,
      size: () => 0,
    }
    const wrapped = withResultCapture("argus_forge_test", fakeTool("OK"), throwingCache)

    expect(await wrapped.execute({} as never, fakeContext("ses_1"))).toBe("OK")
  })

  it("preserves the original description and args", () => {
    const cache = createToolResultCache()
    const original = fakeTool("x")
    const wrapped = withResultCapture("argus_slither_analyze", original, cache)

    expect(wrapped.description).toBe(original.description)
    expect(wrapped.args).toBe(original.args)
  })
})
