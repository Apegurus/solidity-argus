import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ResolvedSkill } from "../../skills/argus-skill-resolver"
import { cliOutput } from "../cli-output"
import {
  ALL_CATEGORIES,
  type ArgusInstall,
  buildSkillHealthReport,
  checkBinary,
  detectInstallDrift,
  doctorCommand,
  enumerateArgusInstallCandidates,
  findDuplicateSkills,
  readJsonCapped,
  SOLC_SELECT_PROBE_ARGS,
} from "./doctor"

function hasTerminalControl(text: string, allowLineFeeds = false): boolean {
  return Array.from(text).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    if (allowLineFeeds && codePoint === 0x0a) return false
    return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)
  })
}

describe("checkBinary", () => {
  it("uses the supported versions subcommand when probing solc-select", () => {
    expect(SOLC_SELECT_PROBE_ARGS).toEqual(["versions"])
  })

  it("withholds non-allowlisted host env vars from the probed child (adj_29)", () => {
    const allowed = new Set([
      "PATH",
      "HOME",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
      "TMPDIR",
      "TEMP",
      "TMP",
      "TERM",
      "TZ",
      "FOUNDRY_PROFILE",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "http_proxy",
      "https_proxy",
      "no_proxy",
    ])
    const leakVar = Object.keys(Bun.env).find(
      (k) => !allowed.has(k) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && (Bun.env[k] ?? "").length > 0,
    )
    expect(leakVar).toBeDefined()
    const result = checkBinary("sh", ["-c", `printf '%s' "\${${leakVar}:-ABSENT}"`])
    expect(result.found).toBe(true)
    expect(result.version).toBe("ABSENT")
  })

  it("removes terminal control bytes from probed version output", () => {
    const maliciousVersion = "v1\u001b[31mRED\u0007\rFORGED\u007f\u0085tail"
    const result = checkBinary("bun", [
      "-e",
      `process.stdout.write(${JSON.stringify(maliciousVersion)})`,
    ])

    expect(result.found).toBe(true)
    expect(hasTerminalControl(result.version ?? "")).toBe(false)
    expect(result.version).toContain("[31mRED")
    expect(result.version).toContain("FORGED")
  })
})

describe("readJsonCapped", () => {
  it("rejects a null-body response instead of an unbounded json() fallback (adj_28)", async () => {
    const res = new Response(null, { status: 200 })
    expect(readJsonCapped(res, 1024)).rejects.toThrow("no readable body")
  })

  it("parses a within-cap JSON body", async () => {
    const res = new Response(JSON.stringify({ version: "1.2.3" }))
    const body = (await readJsonCapped(res, 1024)) as { version: string }
    expect(body.version).toBe("1.2.3")
  })
})

function makeSkill(
  name: string,
  source: ResolvedSkill["source"],
  frontmatter?: { category?: string; version?: string },
): ResolvedSkill {
  const fmLines: string[] = [`name: ${name}`]
  if (frontmatter?.category) fmLines.push(`category: ${frontmatter.category}`)
  if (frontmatter?.version) fmLines.push(`version: ${frontmatter.version}`)
  const content = `---\n${fmLines.join("\n")}\n---\n# ${name}\nBody content.`
  return { name, description: "", filePath: `/fake/${source}/${name}.md`, source, content }
}

function makeInvalidSkill(name: string, source: ResolvedSkill["source"]): ResolvedSkill {
  const content = `---\nname: INVALID NAME WITH SPACES\ncategory: not-a-category\n---\n# bad`
  return { name, description: "", filePath: `/fake/${source}/${name}.md`, source, content }
}

function makeNoFrontmatterSkill(name: string, source: ResolvedSkill["source"]): ResolvedSkill {
  return {
    name,
    description: "",
    filePath: `/fake/${source}/${name}.md`,
    source,
    content: `# ${name}\nNo frontmatter.`,
  }
}

describe("doctorCommand", () => {
  const originalFetch = globalThis.fetch
  const originalLog = cliOutput.log

  beforeEach(() => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("ok", { status: 200 })),
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    cliOutput.log = originalLog
  })

  it("has correct name and description", () => {
    expect(doctorCommand.name).toBe("doctor")
    expect(doctorCommand.description).toBeTruthy()
  })

  it("execute returns a number", async () => {
    const exitCode = await doctorCommand.execute([])
    expect(typeof exitCode).toBe("number")
    expect([0, 1]).toContain(exitCode)
  })

  it("reports Solodit as enabled without probing a local MCP server", async () => {
    const output: string[] = []
    cliOutput.log = (...args: unknown[]) => output.push(args.join(" "))

    await doctorCommand.execute([])

    expect(output.join("\n")).toContain("Solodit: enabled (direct tRPC search)")
  })

  it("reports solc-select availability for the flatten fallback", async () => {
    const output: string[] = []
    cliOutput.log = (...args: unknown[]) => output.push(args.join(" "))

    await doctorCommand.execute([])

    expect(output.join("\n")).toContain("solc-select")
  })
})

describe("buildSkillHealthReport", () => {
  it("counts categories correctly", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["reentrancy", makeSkill("reentrancy", "bundled", { category: "vulnerability-pattern" })],
      ["oracle", makeSkill("oracle", "bundled", { category: "vulnerability-pattern" })],
      ["audit-flow", makeSkill("audit-flow", "bundled", { category: "methodology" })],
      ["amm-dex", makeSkill("amm-dex", "bundled", { category: "protocol-pattern" })],
    ])
    const report = buildSkillHealthReport(skills)
    expect(report.categoryBreakdown["vulnerability-pattern"]).toBe(2)
    expect(report.categoryBreakdown.methodology).toBe(1)
    expect(report.categoryBreakdown["protocol-pattern"]).toBe(1)
    expect(report.categoryBreakdown.checklist).toBe(0)
    expect(report.categoryBreakdown.reference).toBe(0)
  })

  it("counts trust tiers correctly", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["a", makeSkill("a", "bundled", { category: "methodology" })],
      ["b", makeSkill("b", "bundled", { category: "methodology" })],
      ["c", makeSkill("c", "custom", { category: "checklist" })],
      ["d", makeSkill("d", "trailofbits", { category: "reference" })],
    ])
    const report = buildSkillHealthReport(skills)
    expect(report.trustTierBreakdown.bundled).toBe(2)
    expect(report.trustTierBreakdown.custom).toBe(1)
    expect(report.trustTierBreakdown.trailofbits).toBe(1)
  })

  it("detects duplicate skills from entries", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["reentrancy", makeSkill("reentrancy", "bundled", { category: "vulnerability-pattern" })],
    ])
    const allEntries = [
      { name: "reentrancy", source: "bundled", filePath: "/bundled/reentrancy/SKILL.md" },
      { name: "reentrancy", source: "custom", filePath: "/custom/reentrancy/SKILL.md" },
      { name: "oracle", source: "bundled", filePath: "/bundled/oracle/SKILL.md" },
    ]
    const report = buildSkillHealthReport(skills, allEntries)
    expect(report.duplicates).toHaveLength(1)
    expect(report.duplicates.at(0)?.name).toBe("reentrancy")
    expect(report.duplicates.at(0)?.sources).toContain("bundled")
    expect(report.duplicates.at(0)?.sources).toContain("custom")
  })

  it("reports no duplicates when entries are unique", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["a", makeSkill("a", "bundled", { category: "methodology" })],
    ])
    const allEntries = [
      { name: "a", source: "bundled", filePath: "/bundled/a/SKILL.md" },
      { name: "b", source: "custom", filePath: "/custom/b/SKILL.md" },
    ]
    const report = buildSkillHealthReport(skills, allEntries)
    expect(report.duplicates).toHaveLength(0)
  })

  it("warns when required categories have 0 skills", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["checky", makeSkill("checky", "bundled", { category: "checklist" })],
    ])
    const report = buildSkillHealthReport(skills)
    expect(report.missingCategories).toContain("vulnerability-pattern")
    expect(report.missingCategories).toContain("methodology")
  })

  it("does not warn when required categories are covered", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["reentrancy", makeSkill("reentrancy", "bundled", { category: "vulnerability-pattern" })],
      ["audit-flow", makeSkill("audit-flow", "bundled", { category: "methodology" })],
    ])
    const report = buildSkillHealthReport(skills)
    expect(report.missingCategories).toHaveLength(0)
  })

  it("counts schema valid and invalid correctly", () => {
    const skills = new Map<string, ResolvedSkill>([
      ["good", makeSkill("good", "bundled", { category: "methodology", version: "1.0.0" })],
      ["bad", makeInvalidSkill("bad", "custom")],
      ["bare", makeNoFrontmatterSkill("bare", "bundled")],
    ])
    const report = buildSkillHealthReport(skills)
    expect(report.schemaValid).toBe(1)
    expect(report.schemaInvalid).toBe(1)
    expect(report.schemaSkipped).toBe(1)
    expect(report.invalidSkills).toHaveLength(1)
    expect(report.invalidSkills.at(0)?.name).toBe("bad")
  })

  it("initializes all category keys to 0", () => {
    const report = buildSkillHealthReport(new Map())
    for (const cat of ALL_CATEGORIES) {
      expect(report.categoryBreakdown[cat]).toBe(0)
    }
  })
})

describe("findDuplicateSkills", () => {
  it("returns empty array when no duplicates", () => {
    const entries = [
      { name: "a", source: "bundled", filePath: "/bundled/a/SKILL.md" },
      { name: "b", source: "custom", filePath: "/custom/b/SKILL.md" },
    ]
    expect(findDuplicateSkills(entries)).toHaveLength(0)
  })

  it("detects skills present in multiple sources", () => {
    const entries = [
      { name: "reentrancy", source: "bundled", filePath: "/bundled/reentrancy/SKILL.md" },
      { name: "reentrancy", source: "custom", filePath: "/custom/reentrancy/SKILL.md" },
      {
        name: "reentrancy",
        source: "trailofbits",
        filePath: "/trailofbits/reentrancy/SKILL.md",
      },
      { name: "oracle", source: "bundled", filePath: "/bundled/oracle/SKILL.md" },
    ]
    const dupes = findDuplicateSkills(entries)
    expect(dupes).toHaveLength(1)
    expect(dupes.at(0)?.name).toBe("reentrancy")
    expect(dupes.at(0)?.sources).toHaveLength(3)
  })

  it("reports distinct same-source candidates with their paths and winner", () => {
    const entries = [
      { name: "a", source: "trailofbits", filePath: "/plugins/a/skills/a/SKILL.md" },
      { name: "a", source: "trailofbits", filePath: "/plugins/b/skills/a/SKILL.md" },
    ]
    const duplicates = findDuplicateSkills(entries)

    expect(duplicates).toHaveLength(1)
    expect(duplicates.at(0)?.paths).toEqual([
      "/plugins/a/skills/a/SKILL.md",
      "/plugins/b/skills/a/SKILL.md",
    ])
    expect(duplicates.at(0)?.winner).toBe("/plugins/a/skills/a/SKILL.md")
  })

  it("removes terminal control bytes from duplicate diagnostic values", () => {
    const entries = [
      {
        name: "a\u001b]8;;https://example.invalid\u0007",
        source: "custom\u001b[31m",
        filePath: "/skills/a\u001b]8;;https://example.invalid\u0007/SKILL.md",
      },
      {
        name: "a\u001b]8;;https://example.invalid\u0007",
        source: "custom\u001b[31m",
        filePath: "/skills/b\u001b[31m/SKILL.md",
      },
    ]

    const duplicate = findDuplicateSkills(entries).at(0)
    const renderedValues = [
      duplicate?.name ?? "",
      ...(duplicate?.sources ?? []),
      ...(duplicate?.paths ?? []),
      duplicate?.winner ?? "",
    ]

    expect(
      renderedValues.every((value) =>
        Array.from(value).every((character) => {
          const codePoint = character.codePointAt(0) ?? 0
          return codePoint >= 0x20 && (codePoint < 0x7f || codePoint > 0x9f)
        }),
      ),
    ).toBe(true)
  })
})

describe("enumerateArgusInstallCandidates", () => {
  it("includes the hoisted-cache path that shadows other installs", () => {
    const candidates = enumerateArgusInstallCandidates("/proj", "/home/me")
    const hoisted = candidates.find((c) => c.source === "hoisted-cache")
    expect(hoisted?.path).toBe("/home/me/.cache/opencode/node_modules/solidity-argus")
  })

  it("includes the canonical package-cache path", () => {
    const candidates = enumerateArgusInstallCandidates("/proj", "/home/me")
    const pkg = candidates.find((c) => c.source === "package-cache")
    expect(pkg?.path).toBe(
      "/home/me/.cache/opencode/packages/solidity-argus@latest/node_modules/solidity-argus",
    )
  })

  it("includes the project-local node_modules path", () => {
    const candidates = enumerateArgusInstallCandidates("/proj", "/home/me")
    const local = candidates.find((c) => c.source === "project-local")
    expect(local?.path).toBe("/proj/node_modules/solidity-argus")
  })
})

describe("detectInstallDrift", () => {
  const current: ArgusInstall = { source: "current", path: "/canonical", version: "0.5.8" }

  it("returns no errors or warnings when no installs are found", () => {
    const result = detectInstallDrift(current, [])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it("returns no errors when hoisted and package-cache versions match", () => {
    const result = detectInstallDrift(current, [
      { source: "hoisted-cache", path: "/h", version: "0.5.8" },
      { source: "package-cache", path: "/p", version: "0.5.8" },
    ])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it("returns an error when hoisted-cache shadows package-cache with a different version", () => {
    const result = detectInstallDrift(current, [
      { source: "hoisted-cache", path: "/h", version: "0.3.7" },
      { source: "package-cache", path: "/p", version: "0.5.8" },
    ])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("0.3.7")
    expect(result.errors[0]).toContain("0.5.8")
    expect(result.errors[0]).toContain("rm -rf")
    expect(result.errors[0]).toContain("/h")
  })

  it("returns a warning when only hoisted-cache exists and drifts from current", () => {
    const result = detectInstallDrift(current, [
      { source: "hoisted-cache", path: "/h", version: "0.3.7" },
    ])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("0.3.7")
    expect(result.warnings[0]).toContain("0.5.8")
  })

  it("returns nothing when hoisted version equals current version", () => {
    const result = detectInstallDrift(current, [
      { source: "hoisted-cache", path: "/h", version: "0.5.8" },
    ])
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it("prefers error over warning when both conditions would trigger", () => {
    const result = detectInstallDrift(current, [
      { source: "hoisted-cache", path: "/h", version: "0.3.7" },
      { source: "package-cache", path: "/p", version: "0.5.8" },
    ])
    expect(result.errors).toHaveLength(1)
    expect(result.warnings).toHaveLength(0)
  })

  it("removes terminal control bytes from install paths and versions", () => {
    const result = detectInstallDrift(
      { source: "current", path: "/canonical", version: "0.5.8\u0085current" },
      [
        {
          source: "hoisted-cache",
          path: "/h\u001b]8;;https://example.invalid\u0007\rforged",
          version: "0.3.7\u007f",
        },
        {
          source: "package-cache",
          path: "/p\nforged",
          version: "0.5.8\u009b31m",
        },
      ],
    )

    const message = result.errors[0] ?? ""
    expect(hasTerminalControl(message, true)).toBe(false)
    expect(message.split("\n")).toHaveLength(5)
    expect(message).toContain("/h ]8;;https://example.invalid  forged")
    expect(message).toContain("/p forged")
  })
})
