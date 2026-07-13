import { afterEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"

type MapValue = Record<string, unknown>
type Reply = { readonly stdout: string; readonly stderr: string; readonly exitCode: number }

const temporaryDirectories: string[] = []
const workflowPath = join(import.meta.dir, "..", "..", ".github", "workflows", "publish.yml")
const e404 = "npm error code E404\nnpm error 404 Not Found"

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

const isMap = (value: unknown): value is MapValue =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const map = (value: unknown, label: string): MapValue => {
  if (!isMap(value)) throw new Error(`${label} must be a mapping`)
  return value
}
const string = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new Error(`${label} must be a string`)
  return value
}
const normalize = (value: string): string => value.replace(/\n(\s*['"])/g, "\\n$1")
const stepRun = (name: string, jobName: "verify" | "publish" = "publish"): string => {
  const root = map(parseYaml(normalize(readFileSync(workflowPath, "utf8"))), "workflow")
  const jobs = map(root.jobs, "jobs")
  const job = map(jobs[jobName], jobName)
  if (!Array.isArray(job.steps)) throw new Error("steps must be an array")
  for (const value of job.steps) {
    const step = map(value, "step")
    if (step.name === name) return string(step.run, `${name}.run`)
  }
  throw new Error(`step not found: ${name}`)
}
const executable = (path: string, body: string): void => {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}`)
  chmodSync(path, 0o755)
}
const harness = (): Record<string, string> => {
  const directory = mkdtempSync(join(tmpdir(), "argus-publish-"))
  temporaryDirectories.push(directory)
  const bin = join(directory, "bin")
  mkdirSync(bin)
  writeFileSync(join(directory, "output"), "")
  executable(
    join(bin, "timeout"),
    `if [ "\${1:-}" = "--preserve-status" ]; then shift; fi\nshift\nexec "$@"\n`,
  )
  executable(
    join(bin, "git"),
    `printf "%s\\n" "$*" >> "$GIT_LOG"\nprintf "%s" "\${GIT_STATUS:-}"\n`,
  )
  executable(
    join(bin, "npm"),
    `count=0\n[ ! -f "$NPM_COUNT" ] || count="$(cat "$NPM_COUNT")"\ncount=$((count + 1))\nprintf "%s" "$count" > "$NPM_COUNT"\nprintf "%s\\n" "$*" >> "$NPM_LOG"\nprefix="NPM_\${count}"\nout="\${prefix}_OUT"; err="\${prefix}_ERR"; code="\${prefix}_CODE"\nprintf "%s" "\${!out-}"\nprintf "%s" "\${!err-}" >&2\nexit "\${!code-0}"\n`,
  )
  return {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: process.env.HOME ?? tmpdir(),
    RUNNER_TEMP: directory,
    GITHUB_OUTPUT: join(directory, "output"),
    GIT_LOG: join(directory, "git.log"),
    GIT_STATUS: "",
    NPM_COUNT: join(directory, "npm.count"),
    NPM_LOG: join(directory, "npm.log"),
    PACKAGE_NAME: "solidity-argus",
    RELEASE_VERSION: "0.8.1",
    RELEASE_TAG: "dev",
    NPM_1_OUT: "",
    NPM_1_ERR: "",
    NPM_1_CODE: "0",
    NPM_2_OUT: "",
    NPM_2_ERR: "",
    NPM_2_CODE: "0",
  }
}
const execute = (script: string, environment: Record<string, string>) => {
  const result = Bun.spawnSync(["bash", "-c", script], {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  }
}
const environmentValue = (environment: Record<string, string>, key: string): string => {
  const value = environment[key]
  if (value === undefined) throw new Error(`missing environment value: ${key}`)
  return value
}
const preflight = (candidate: Reply, tag: Reply, releaseTag = "dev") => {
  const environment = harness()
  Object.assign(environment, {
    RELEASE_TAG: releaseTag,
    NPM_1_OUT: candidate.stdout,
    NPM_1_ERR: candidate.stderr,
    NPM_1_CODE: String(candidate.exitCode),
    NPM_2_OUT: tag.stdout,
    NPM_2_ERR: tag.stderr,
    NPM_2_CODE: String(tag.exitCode),
  })
  const result = execute(stepRun("Registry preflight"), environment)
  const calls = readFileSync(environmentValue(environment, "NPM_LOG"), "utf8").trim().split(/\r?\n/)
  expect(calls).toEqual([
    "view solidity-argus@0.8.1 version --registry https://registry.npmjs.org/ --json",
    `view solidity-argus@${releaseTag} version --registry https://registry.npmjs.org/ --json`,
  ])
  const outputPath = environmentValue(environment, "GITHUB_OUTPUT")
  return {
    ...result,
    logPath: environmentValue(environment, "NPM_LOG"),
    output: existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "",
  }
}
const found = (version: string): Reply => ({
  stdout: JSON.stringify(version),
  stderr: "",
  exitCode: 0,
})
const missing = (): Reply => ({ stdout: "", stderr: e404, exitCode: 1 })

describe("publish workflow behavior", () => {
  test("Given a clean checkout When the clean guard runs Then it passes", () => {
    const environment = harness()
    expect(execute(stepRun("Clean release workspace", "verify"), environment).exitCode).toBe(0)
    expect(readFileSync(environmentValue(environment, "GIT_LOG"), "utf8").trim()).toBe(
      "status --porcelain=v1 --untracked-files=all",
    )
  })

  test("Given tracked or untracked dirt When the clean guard runs Then it fails before release mutation", () => {
    for (const dirt of [" M package.json\n", "?? scratch.txt\n"]) {
      const environment = harness()
      environment.GIT_STATUS = dirt
      expect(execute(stepRun("Clean release workspace", "verify"), environment).exitCode).toBe(1)
    }
  })

  const cases: readonly [string, Reply, Reply, number, number, string?, string?][] = [
    ["dev match", found("0.8.1"), found("0.8.1"), 2, 0, "already_published=true"],
    ["latest match", found("0.8.1"), found("0.8.1"), 2, 0, "already_published=true", "latest"],
    ["dev missing older", missing(), found("0.8.0"), 2, 0, "already_published=false"],
    ["latest missing older", missing(), found("0.8.0"), 2, 0, "already_published=false", "latest"],
    ["dev both missing", missing(), missing(), 2, 0, "already_published=false"],
    ["latest both missing", missing(), missing(), 2, 0, "already_published=false", "latest"],
    ["dev exists older", found("0.8.1"), found("0.8.0"), 2, 1],
    ["latest exists older", found("0.8.1"), found("0.8.0"), 2, 1, undefined, "latest"],
    ["dev exists missing", found("0.8.1"), missing(), 2, 1],
    ["latest exists missing", found("0.8.1"), missing(), 2, 1, undefined, "latest"],
    ["dev missing equal", missing(), found("0.8.1"), 2, 1],
    ["latest missing equal", missing(), found("0.8.1"), 2, 1, undefined, "latest"],
    ["dev missing newer", missing(), found("0.8.2"), 2, 1],
    ["latest missing newer", missing(), found("0.8.2"), 2, 1, undefined, "latest"],
    ["dev not-semver", missing(), found("not-semver"), 2, 1],
    ["latest not-semver", missing(), found("not-semver"), 2, 1, undefined, "latest"],
    ["candidate parse fail", { stdout: "not-json", stderr: "", exitCode: 0 }, found("0.8.0"), 2, 1],
    ["tag parse fail", missing(), { stdout: "[]", stderr: "", exitCode: 0 }, 2, 1],
    [
      "candidate auth fail",
      { stdout: "", stderr: "npm error code E401", exitCode: 1 },
      found("0.8.0"),
      2,
      1,
    ],
    ["tag auth fail", missing(), { stdout: "", stderr: "npm error code E401", exitCode: 1 }, 2, 1],
    [
      "candidate net fail",
      { stdout: "", stderr: "fetch failed", exitCode: 1 },
      found("0.8.0"),
      2,
      1,
    ],
    ["tag net fail", missing(), { stdout: "", stderr: "fetch failed", exitCode: 1 }, 2, 1],
  ]
  for (const [name, candidate, tag, expectedCalls, exitCode, output, releaseTag] of cases) {
    test(`Given ${name} When registry preflight runs Then it is classified truthfully`, () => {
      const result = preflight(candidate, tag, releaseTag)
      expect(result.exitCode).toBe(exitCode)
      expect(readFileSync(result.logPath, "utf8").trim().split(/\r?\n/)).toHaveLength(expectedCalls)
      if (output) expect(result.output).toContain(output)
    })
  }
})
