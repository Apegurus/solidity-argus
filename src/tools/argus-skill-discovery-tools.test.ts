import { describe, expect, it } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import type { ArgusConfig } from "../config/types"
import type { ResolvedSkill } from "../skills/argus-skill-resolver"
import {
  argusListSkillsTool,
  argusRecommendSkillsTool,
  executeArgusListSkills,
  executeArgusRecommendSkills,
} from "./argus-skill-discovery-tools"

function createContext(): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata() {
      return
    },
    async ask() {
      return
    },
  }
}

function createConfig(): ArgusConfig {
  return {
    agents: { argus: {}, sentinel: {}, pythia: {}, auditSpecialist: {}, scribe: {}, themis: {} },
    tools: {},
    knowledge: {
      scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
      autoSync: true,
      skillPrecedence: "bundled-first",
    },
    reporting: {
      confidenceThreshold: 80,
      severityThreshold: "low",
      output_dir: ".opencode/reports/",
    },
    solodit: { enabled: true },
    disabled_hooks: [],
  }
}

function createSkills(): Map<string, ResolvedSkill> {
  return new Map([
    [
      "reentrancy",
      {
        name: "reentrancy",
        description: "Detect reentrancy patterns",
        category: "vulnerability-pattern",
        pattern_category: "reentrancy",
        detection_rules: [
          {
            regex: "\\.call\\{value:",
            severity: "High",
            confidence: "High",
            description: "External value transfer",
          },
        ],
        filePath: "/skills/vulnerability-patterns/reentrancy/SKILL.md",
        source: "bundled",
        content: "# Reentrancy\nSECRET BODY SHOULD NOT LEAK",
      },
    ],
    [
      "erc4626-exchange-rate-manipulation",
      {
        name: "erc4626-exchange-rate-manipulation",
        description: "ERC4626 vault exchange-rate manipulation and donation attacks",
        category: "vulnerability-pattern",
        pattern_category: "erc4626",
        detection_rules: [
          {
            regex: "convertToAssets",
            severity: "High",
            description: "ERC4626 conversion surface",
          },
        ],
        filePath: "/skills/vulnerability-patterns/erc4626-exchange-rate-manipulation/SKILL.md",
        source: "bundled",
        content: "# ERC4626\nPRIVATE ERC4626 BODY",
      },
    ],
    [
      "amm-dex",
      {
        name: "amm-dex",
        description: "AMM and DEX protocol review guide",
        category: "protocol-pattern",
        filePath: "/custom/amm-dex/SKILL.md",
        source: "custom",
        content: "# AMM\nCUSTOM BODY",
      },
    ],
  ])
}

describe("argus skill discovery tools", () => {
  it("uses tool() helper contracts", () => {
    expect(argusListSkillsTool.description.length).toBeGreaterThan(0)
    expect(argusListSkillsTool.args).toBeDefined()
    expect(typeof argusListSkillsTool.execute).toBe("function")
    expect(argusRecommendSkillsTool.description.length).toBeGreaterThan(0)
    expect(argusRecommendSkillsTool.args).toBeDefined()
    expect(typeof argusRecommendSkillsTool.execute).toBe("function")
  })

  it("lists metadata only and never leaks skill bodies", async () => {
    const payload = await executeArgusListSkills({}, createContext(), {
      loadConfig: createConfig,
      resolveSkills: createSkills,
    })
    const result = JSON.parse(payload) as {
      total: number
      skills: Array<{ name: string; scanned_by_patterns: boolean }>
      categories: Record<string, { count: number; examples: string[] }>
    }

    expect(result.total).toBe(3)
    expect(result.skills.map((skill) => skill.name)).toContain("reentrancy")
    expect(result.skills.find((skill) => skill.name === "reentrancy")?.scanned_by_patterns).toBe(
      true,
    )
    expect(result.categories["vulnerability-pattern"]?.count).toBe(2)
    expect(payload).not.toContain("SECRET BODY SHOULD NOT LEAK")
    expect(payload).not.toContain("PRIVATE ERC4626 BODY")
    expect(payload).not.toContain("content")
  })

  it("filters by query, category, source, pattern_category, and scanned_by_patterns", async () => {
    const payload = await executeArgusListSkills(
      {
        query: "vault donation",
        category: "vulnerability-pattern",
        source: "bundled",
        pattern_category: "erc4626",
        scanned_by_patterns: true,
      },
      createContext(),
      {
        loadConfig: createConfig,
        resolveSkills: createSkills,
      },
    )
    const result = JSON.parse(payload) as { skills: Array<{ name: string }> }

    expect(result.skills.map((skill) => skill.name)).toEqual(["erc4626-exchange-rate-manipulation"])
  })

  it("recommends skills deterministically with reasons and metadata only", async () => {
    const payload = await executeArgusRecommendSkills(
      {
        context: "ERC4626 vault uses convertToAssets, totalAssets, donation attacks, and shares",
        limit: 2,
      },
      createContext(),
      {
        loadConfig: createConfig,
        resolveSkills: createSkills,
      },
    )
    const result = JSON.parse(payload) as {
      recommendations: Array<{ name: string; reasons: string[] }>
    }

    expect(result.recommendations[0]?.name).toBe("erc4626-exchange-rate-manipulation")
    expect(result.recommendations[0]?.reasons.join(" ")).toContain("erc4626")
    expect(payload).not.toContain("PRIVATE ERC4626 BODY")
    expect(payload).not.toContain("content")
  })
})
