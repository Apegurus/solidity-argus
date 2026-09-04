import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"

type MapValue = Record<string, unknown>

const roots: string[] = []
const workflowPath = join(import.meta.dir, "..", "..", ".github", "workflows", "publish.yml")
const commit = "0123456789abcdef0123456789abcdef01234567"

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const map = (value: unknown, label: string): MapValue => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be a mapping`)
  return Object.fromEntries(Object.entries(value))
}

const validationScript = (): string => {
  const jobs = map(map(parseYaml(readFileSync(workflowPath, "utf8")), "workflow").jobs, "jobs")
  const publish = map(jobs.publish, "publish")
  if (!Array.isArray(publish.steps)) throw new Error("publish.steps must be an array")
  for (const candidate of publish.steps) {
    const item = map(candidate, "step")
    if (item.name === "Validate release artifact" && typeof item.run === "string") return item.run
  }
  throw new Error("validation step missing")
}

const executeValidation = (
  version: string,
  branch: "main" | "staging",
  publishConfig?: MapValue,
) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "argus-artifact-")))
  roots.push(root)
  const artifact = join(root, "artifact")
  const packageRoot = join(root, "fixture", "package")
  mkdirSync(artifact)
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "solidity-argus", version, publishConfig }),
  )
  writeFileSync(
    join(packageRoot, "build-info.json"),
    JSON.stringify({ version, commit, dirty: false }),
  )
  const tgz = join(artifact, "release.tgz")
  const packed = Bun.spawnSync(["tar", "-czf", tgz, "-C", join(root, "fixture"), "package"])
  expect(packed.exitCode).toBe(0)
  const output = join(root, "output")
  writeFileSync(output, "")
  const result = Bun.spawnSync(["bash", "-c", validationScript()], {
    env: {
      ...process.env,
      ARTIFACT_DIR: artifact,
      EXPECTED_PACKAGE: "solidity-argus",
      RUNNER_TEMP: root,
      GITHUB_OUTPUT: output,
      GITHUB_REF_NAME: branch,
      GITHUB_RUN_ID: "12345678",
      GITHUB_SHA: commit,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    output: readFileSync(output, "utf8"),
    stderr: new TextDecoder().decode(result.stderr),
  }
}

const publicRegistry = {
  access: "public",
  registry: "https://registry.npmjs.org/",
} as const

describe("publish artifact validation", () => {
  test("Given exact channel versions When validated Then stable and dev artifacts pass", () => {
    const stable = executeValidation("0.8.0", "main", publicRegistry)
    expect(stable.stderr).toBe("")
    expect(stable.exitCode).toBe(0)
    expect(
      executeValidation("0.8.0-dev.12345678.g0123456", "staging", publicRegistry).exitCode,
    ).toBe(0)
  })

  for (const [name, version, branch] of [
    ["stable prerelease", "0.8.0-dev.12345678.g0123456", "main"],
    ["dev wrong run", "0.8.0-dev.87654321.g0123456", "staging"],
    ["dev wrong sha", "0.8.0-dev.12345678.gabcdef0", "staging"],
    ["dev loose suffix", "0.8.0-dev.12345678.g0123456.extra", "staging"],
  ] as const) {
    test(`Given a tampered ${name} version When validated Then publishing is rejected`, () => {
      expect(executeValidation(version, branch, publicRegistry).exitCode).not.toBe(0)
    })
  }

  for (const [name, publishConfig] of [
    ["private access", { ...publicRegistry, access: "restricted" }],
    ["alternate registry", { ...publicRegistry, registry: "https://registry.example.com/" }],
    ["missing publish config", undefined],
  ] as const) {
    test(`Given ${name} tampering When validated Then publishing is rejected`, () => {
      expect(executeValidation("0.8.0", "main", publishConfig).exitCode).not.toBe(0)
    })
  }
})
