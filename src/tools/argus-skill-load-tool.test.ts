import { describe, expect, it } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { argusSkillLoadTool, executeArgusSkillLoad } from "./argus-skill-load-tool"

function createContext(): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "sentinel",
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

describe("argusSkillLoadTool", () => {
  it("uses tool() helper contract", () => {
    expect(argusSkillLoadTool.description.length).toBeGreaterThan(0)
    expect(argusSkillLoadTool.args).toBeDefined()
    expect(typeof argusSkillLoadTool.execute).toBe("function")
  })

  it("loads skill by canonical name", async () => {
    const content = await executeArgusSkillLoad({ name: "reentrancy" }, createContext(), {
      loadConfig: () => ({
        agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
        tools: {},
        knowledge: {
          scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
          autoSync: true,
          skillPrecedence: "bundled-first" as const,
        },
        reporting: { format: "markdown", severityThreshold: "low", gasAnalysis: false, output_dir: ".opencode/reports/" },
        solodit: { enabled: true, port: 3000 },
        disabled_hooks: [],
        hooks: {},
        cli: {},
        background: { max_concurrent: 3 },
      }),
      resolveSkills: () =>
        new Map([
          [
            "reentrancy",
            {
              name: "reentrancy",
              description: "Detect reentrancy patterns",
              filePath: "/skills/reentrancy/SKILL.md",
              source: "bundled",
              content: "# Reentrancy\nUse CEI.",
            },
          ],
        ]),
    })

    expect(content).toContain("## Argus Skill: reentrancy")
    expect(content).toContain("Use CEI")
  })

  it("normalizes namespaced name and loads canonical skill", async () => {
    const content = await executeArgusSkillLoad(
      { name: "vulnerability-patterns/reentrancy" },
      createContext(),
      {
        loadConfig: () => {
          throw new Error("no config")
        },
        resolveSkills: () =>
          new Map([
            [
              "reentrancy",
              {
                name: "reentrancy",
                description: "",
                filePath: "/skills/reentrancy/SKILL.md",
                source: "bundled",
                content: "# Reentrancy",
              },
            ],
          ]),
      },
    )

    expect(content).toContain("## Argus Skill: reentrancy")
  })

  it("throws with available skills when missing", async () => {
    await expect(
      executeArgusSkillLoad({ name: "does-not-exist" }, createContext(), {
        loadConfig: () => {
          throw new Error("no config")
        },
        resolveSkills: () =>
          new Map([
            [
              "reentrancy",
              {
                name: "reentrancy",
                description: "",
                filePath: "/skills/reentrancy/SKILL.md",
                source: "bundled",
                content: "# Reentrancy",
              },
            ],
          ]),
      }),
    ).rejects.toThrow("Available Argus skills: reentrancy")
  })

  it("includes trust tier as [Source: ...] in output header", async () => {
    const content = await executeArgusSkillLoad({ name: "reentrancy" }, createContext(), {
      loadConfig: () => ({
        agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
        tools: {},
        knowledge: {
          scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
          autoSync: true,
          skillPrecedence: "bundled-first" as const,
        },
        reporting: {
          format: "markdown" as const,
          severityThreshold: "low" as const,
          gasAnalysis: false,
          output_dir: ".opencode/reports/",
        },
        solodit: { enabled: true, port: 3000 },
        disabled_hooks: [],
        hooks: {},
        cli: {},
        background: { max_concurrent: 3 },
      }),
      resolveSkills: () =>
        new Map([
          [
            "reentrancy",
            {
              name: "reentrancy",
              description: "Detect reentrancy",
              filePath: "/skills/reentrancy/SKILL.md",
              source: "bundled" as const,
              content: "# Reentrancy\nUse CEI.",
            },
          ],
        ]),
    })

    expect(content).toContain("[Source: bundled]")
  })

  it("shows custom trust tier for custom-sourced skills", async () => {
    const content = await executeArgusSkillLoad({ name: "my-custom-skill" }, createContext(), {
      loadConfig: () => {
        throw new Error("no config")
      },
      resolveSkills: () =>
        new Map([
          [
            "my-custom-skill",
            {
              name: "my-custom-skill",
              description: "Custom skill",
              filePath: "/custom/my-custom-skill/SKILL.md",
              source: "custom" as const,
              content: "# Custom",
            },
          ],
        ]),
    })

    expect(content).toContain("[Source: custom]")
  })

  it("includes provenance section when source_url and source_license are present", async () => {
    const content = await executeArgusSkillLoad({ name: "reentrancy" }, createContext(), {
      loadConfig: () => ({
        agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
        tools: {},
        knowledge: {
          scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
          autoSync: true,
          skillPrecedence: "bundled-first" as const,
        },
        reporting: {
          format: "markdown" as const,
          severityThreshold: "low" as const,
          gasAnalysis: false,
          output_dir: ".opencode/reports/",
        },
        solodit: { enabled: true, port: 3000 },
        disabled_hooks: [],
        hooks: {},
        cli: {},
        background: { max_concurrent: 3 },
      }),
      resolveSkills: () =>
        new Map([
          [
            "reentrancy",
            {
              name: "reentrancy",
              description: "Reentrancy patterns",
              filePath: "/skills/reentrancy/SKILL.md",
              source: "bundled" as const,
              content: "# Reentrancy\nUse CEI.",
              source_url: "https://github.com/kadenzipfel/smart-contract-vulnerabilities",
              source_license: "MIT",
              imported_at: "2025-01-15T00:00:00Z",
            },
          ],
        ]),
    })

    expect(content).toContain(
      "[Provenance: MIT | https://github.com/kadenzipfel/smart-contract-vulnerabilities | Imported: 2025-01-15T00:00:00Z]",
    )
  })

  it("omits provenance section when no provenance fields are present", async () => {
    const content = await executeArgusSkillLoad({ name: "reentrancy" }, createContext(), {
      loadConfig: () => ({
        agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
        tools: {},
        knowledge: {
          scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
          autoSync: true,
          skillPrecedence: "bundled-first" as const,
        },
        reporting: {
          format: "markdown" as const,
          severityThreshold: "low" as const,
          gasAnalysis: false,
          output_dir: ".opencode/reports/",
        },
        solodit: { enabled: true, port: 3000 },
        disabled_hooks: [],
        hooks: {},
        cli: {},
        background: { max_concurrent: 3 },
      }),
      resolveSkills: () =>
        new Map([
          [
            "reentrancy",
            {
              name: "reentrancy",
              description: "Reentrancy patterns",
              filePath: "/skills/reentrancy/SKILL.md",
              source: "bundled" as const,
              content: "# Reentrancy\nUse CEI.",
            },
          ],
        ]),
    })

    expect(content).not.toContain("[Provenance:")
  })

  it("shows partial provenance when only some fields are present", async () => {
    const content = await executeArgusSkillLoad({ name: "reentrancy" }, createContext(), {
      loadConfig: () => ({
        agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
        tools: {},
        knowledge: {
          scvd: { enabled: true, apiUrl: "https://api.scvd.dev" },
          autoSync: true,
          skillPrecedence: "bundled-first" as const,
        },
        reporting: {
          format: "markdown" as const,
          severityThreshold: "low" as const,
          gasAnalysis: false,
          output_dir: ".opencode/reports/",
        },
        solodit: { enabled: true, port: 3000 },
        disabled_hooks: [],
        hooks: {},
        cli: {},
        background: { max_concurrent: 3 },
      }),
      resolveSkills: () =>
        new Map([
          [
            "reentrancy",
            {
              name: "reentrancy",
              description: "Reentrancy patterns",
              filePath: "/skills/reentrancy/SKILL.md",
              source: "bundled" as const,
              content: "# Reentrancy\nUse CEI.",
              source_license: "MIT",
            },
          ],
        ]),
    })

    expect(content).toContain("[Provenance: MIT]")
  })
})
