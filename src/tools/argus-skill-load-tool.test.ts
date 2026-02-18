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
    const content = await executeArgusSkillLoad(
      { name: "reentrancy" },
      createContext(),
      {
        loadConfig: () => ({
          agents: { argus: {}, sentinel: {}, pythia: {}, scribe: {} },
          tools: {},
          knowledge: { scvd: { enabled: true, apiUrl: "https://api.scvd.dev" }, autoSync: true },
          reporting: { format: "markdown", severityThreshold: "low", gasAnalysis: false },
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
      }
    )

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
      }
    )

    expect(content).toContain("## Argus Skill: reentrancy")
  })

  it("throws with available skills when missing", async () => {
    await expect(
      executeArgusSkillLoad(
        { name: "does-not-exist" },
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
        }
      )
    ).rejects.toThrow('Available Argus skills: reentrancy')
  })
})
