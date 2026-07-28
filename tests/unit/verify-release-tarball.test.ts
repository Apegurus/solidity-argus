import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const roots: string[] = []
const verifier = join(import.meta.dir, "..", "..", "scripts", "verify-release-tarball.ts")
const version = "0.8.1"
const commit = "0123456789abcdef0123456789abcdef01234567"

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const fixture = (
  changes: {
    readonly version?: string
    readonly publishConfig?: unknown
    readonly buildVersion?: string
    readonly buildCommit?: string
    readonly dirty?: boolean
    readonly forbiddenPath?: string
    readonly omitReadme?: boolean
    readonly omitSkills?: boolean
    readonly omitAgents?: boolean
    readonly omitLicense?: boolean
    readonly omitCli?: boolean
    readonly bin?: {
      readonly "solidity-argus"?: string
      readonly argus?: string
    }
    readonly scripts?: Record<string, string>
  } = {},
): readonly [string, string] => {
  const root = mkdtempSync(join(tmpdir(), "argus-tarball-"))
  roots.push(root)
  const packageRoot = join(root, "package")
  mkdirSync(join(packageRoot, "src", "cli"), { recursive: true })
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "solidity-argus",
      version: changes.version ?? version,
      publishConfig: changes.publishConfig ?? {
        access: "public",
        registry: "https://registry.npmjs.org/",
      },
      bin: changes.bin ?? {
        "solidity-argus": "src/cli/index.ts",
        argus: "src/cli/index.ts",
      },
      scripts: changes.scripts ?? { prepack: "bun scripts/stamp-build-info.ts" },
    }),
  )
  writeFileSync(
    join(packageRoot, "build-info.json"),
    JSON.stringify({
      version: changes.buildVersion ?? version,
      commit: changes.buildCommit ?? commit,
      dirty: changes.dirty ?? false,
    }),
  )
  writeFileSync(join(packageRoot, "src", "index.ts"), "export const ok = true\n")
  if (!changes.omitCli)
    writeFileSync(join(packageRoot, "src", "cli", "index.ts"), "#!/usr/bin/env bun\n")
  if (!changes.omitReadme) writeFileSync(join(packageRoot, "README.md"), "# Argus\n")
  if (!changes.omitSkills) {
    mkdirSync(join(packageRoot, "skills", "example"), { recursive: true })
    writeFileSync(join(packageRoot, "skills", "example", "SKILL.md"), "# Example\n")
  }
  if (!changes.omitAgents) writeFileSync(join(packageRoot, "AGENTS.md"), "# Agents\n")
  if (!changes.omitLicense) writeFileSync(join(packageRoot, "LICENSE"), "MIT\n")
  if (changes.forbiddenPath) {
    const forbidden = join(packageRoot, changes.forbiddenPath)
    mkdirSync(join(forbidden, ".."), { recursive: true })
    writeFileSync(forbidden, "test()\n")
  }
  const tgz = join(root, "solidity-argus-0.8.1.tgz")
  execFileSync("tar", ["-czf", tgz, "package"], { cwd: root })
  const packJson = join(root, "pack.json")
  writeFileSync(packJson, JSON.stringify([{ filename: "solidity-argus-0.8.1.tgz" }]))
  return [packJson, root]
}

const verify = (changes?: Parameters<typeof fixture>[0]) => {
  const [packJson, root] = fixture(changes)
  return Bun.spawnSync(["bun", verifier, packJson, "solidity-argus", version, commit, root], {
    stdout: "pipe",
    stderr: "pipe",
  })
}

describe("release tarball verifier", () => {
  test("Given an exact release archive When verified Then its absolute path is returned", () => {
    const result = verify()
    expect(result.exitCode).toBe(0)
    expect(new TextDecoder().decode(result.stdout)).toEndWith("solidity-argus-0.8.1.tgz")
  })

  const invalid: readonly [string, Parameters<typeof fixture>[0], string][] = [
    ["package version differs", { version: "9.9.9" }, "package version mismatch"],
    [
      "publishConfig differs",
      { publishConfig: { access: "restricted" } },
      "package manifest mismatch",
    ],
    ["build version differs", { buildVersion: "9.9.9" }, "build-info mismatch"],
    ["full commit differs", { buildCommit: commit.slice(0, 7) }, "build-info mismatch"],
    ["build is dirty", { dirty: true }, "build-info mismatch"],
    ["README is absent", { omitReadme: true }, "required files missing"],
    ["skills are absent", { omitSkills: true }, "required files missing"],
    ["agent instructions are absent", { omitAgents: true }, "required files missing"],
    ["license is absent", { omitLicense: true }, "required files missing"],
    ["the declared CLI target is absent", { omitCli: true }, "required files missing"],
    [
      "the argus bin target is absent",
      { bin: { "solidity-argus": "src/cli/index.ts" } },
      "package manifest mismatch",
    ],
    [
      "an install lifecycle script is declared",
      { scripts: { install: "node install.js" } },
      "install lifecycle scripts forbidden",
    ],
    [
      "a prepare lifecycle script is declared",
      { scripts: { prepare: "node prepare.js" } },
      "install lifecycle scripts forbidden",
    ],
    [
      "test source is packed",
      { forbiddenPath: "src/index.test.ts" },
      "forbidden test files packed",
    ],
    [
      "spec JavaScript is packed",
      { forbiddenPath: "src/index.spec.js" },
      "forbidden test files packed",
    ],
    ["JSX test is packed", { forbiddenPath: "src/view.test.jsx" }, "forbidden test files packed"],
    ["TSX spec is packed", { forbiddenPath: "src/view.spec.tsx" }, "forbidden test files packed"],
    ["MJS test is packed", { forbiddenPath: "src/index.test.mjs" }, "forbidden test files packed"],
    ["CJS spec is packed", { forbiddenPath: "src/index.spec.cjs" }, "forbidden test files packed"],
    ["MTS test is packed", { forbiddenPath: "src/index.test.mts" }, "forbidden test files packed"],
    ["CTS spec is packed", { forbiddenPath: "src/index.spec.cts" }, "forbidden test files packed"],
    [
      "test directory is packed",
      { forbiddenPath: "src/test/fixture.json" },
      "forbidden test files packed",
    ],
    [
      "tests directory is packed",
      { forbiddenPath: "tests/fixture.json" },
      "forbidden test files packed",
    ],
    [
      "spec directory is packed",
      { forbiddenPath: "src/spec/fixture.json" },
      "forbidden test files packed",
    ],
    [
      "specs directory is packed",
      { forbiddenPath: "specs/fixture.json" },
      "forbidden test files packed",
    ],
    [
      "dunder tests directory is packed",
      { forbiddenPath: "src/__tests__/fixture.json" },
      "forbidden test files packed",
    ],
  ]
  for (const [condition, changes, message] of invalid) {
    test(`Given ${condition} When verified Then verification fails`, () => {
      const result = verify(changes)
      expect(result.exitCode).toBe(1)
      expect(new TextDecoder().decode(result.stderr)).toContain(message)
    })
  }
})
