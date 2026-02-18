import { describe, expect, it } from "bun:test"
import { createTools } from "./create-tools"
import { ArgusConfigSchema } from "./config/schema"

const ALL_TOOL_KEYS = [
  "argus_slither_analyze",
  "argus_forge_test",
  "argus_forge_fuzz",
  "argus_analyze_contract",
  "argus_check_patterns",
  "argus_solodit_search",
  "argus_generate_report",
  "argus_sync_knowledge",
] as const

describe("createTools", () => {
  it("returns exactly 8 tools with default config", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)

    expect(Object.keys(tools)).toHaveLength(8)
    for (const key of ALL_TOOL_KEYS) {
      expect(tools).toHaveProperty(key)
    }
  })

  it("all returned tool values are defined", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)

    for (const [, value] of Object.entries(tools)) {
      expect(value).toBeDefined()
      expect(value).not.toBeNull()
      expect(value).toHaveProperty("description")
      expect(value).toHaveProperty("args")
      expect(value).toHaveProperty("execute")
    }
  })

  it("excludes argus_solodit_search when solodit.enabled is false", () => {
    const config = ArgusConfigSchema.parse({ solodit: { enabled: false } })
    const tools = createTools(config)

    expect(Object.keys(tools)).toHaveLength(7)
    expect(tools).not.toHaveProperty("argus_solodit_search")

    const otherKeys = ALL_TOOL_KEYS.filter((k) => k !== "argus_solodit_search")
    for (const key of otherKeys) {
      expect(tools).toHaveProperty(key)
    }
  })

  it("includes argus_solodit_search when solodit.enabled is true", () => {
    const config = ArgusConfigSchema.parse({ solodit: { enabled: true } })
    const tools = createTools(config)

    expect(Object.keys(tools)).toHaveLength(8)
    expect(tools).toHaveProperty("argus_solodit_search")
  })

  it("tool keys match exactly what index.ts registers", () => {
    const config = ArgusConfigSchema.parse({})
    const tools = createTools(config)
    const keys = Object.keys(tools).sort()

    expect(keys).toEqual([...ALL_TOOL_KEYS].sort())
  })
})
