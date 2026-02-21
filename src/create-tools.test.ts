import { describe, expect, it } from "bun:test"
import type { ArgusConfig } from "./config/types"
import { createTools } from "./create-tools"

const baseConfig: ArgusConfig = {
  agents: {
    argus: {},
    sentinel: {},
    pythia: {},
    scribe: {},
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
}

describe("createTools", () => {
  it("registers exactly 12 tools when solodit is enabled", () => {
    const config: ArgusConfig = {
      ...baseConfig,
      solodit: { enabled: true, port: 3000 },
    }
    const tools = createTools(config)
    const toolNames = Object.keys(tools).sort()

    expect(toolNames).toHaveLength(12)
    expect(toolNames).toEqual([
      "argus_analyze_contract",
      "argus_check_patterns",
      "argus_forge_coverage",
      "argus_forge_fuzz",
      "argus_forge_test",
      "argus_gas_analysis",
      "argus_generate_report",
      "argus_proxy_detection",
      "argus_skill_load",
      "argus_slither_analyze",
      "argus_solodit_search",
      "argus_sync_knowledge",
    ])
  })

  it("registers 11 tools when solodit is disabled", () => {
    const config: ArgusConfig = {
      ...baseConfig,
      solodit: { enabled: false, port: 3000 },
    }
    const tools = createTools(config)

    expect(Object.keys(tools)).toHaveLength(11)
    expect(tools.argus_solodit_search).toBeUndefined()
  })
})
