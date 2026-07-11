import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"

type MapValue = Record<string, unknown>
type Sandbox = {
  readonly root: string
  readonly manifest: string
  readonly environment: Record<string, string>
}

const roots: string[] = []
const workflowPath = join(import.meta.dir, "..", "..", ".github", "workflows", "publish.yml")
const originalManifest = '{"name":"solidity-argus","version":"0.8.0","marker":"exact bytes"}\n'

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const map = (value: unknown, label: string): MapValue => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be a mapping`)
  return Object.fromEntries(Object.entries(value))
}
const packScript = (): string => {
  const yaml = readFileSync(workflowPath, "utf8").replace(/\n(\s*['"])/g, "\\n$1")
  const workflow = map(parseYaml(yaml), "workflow")
  const jobs = map(workflow.jobs, "jobs")
  const verify = map(jobs.verify, "verify")
  if (!Array.isArray(verify.steps)) throw new Error("steps must be an array")
  for (const candidate of verify.steps) {
    const step = map(candidate, "step")
    if (step.name === "Pack release tarball" && typeof step.run === "string") return step.run
  }
  throw new Error("pack step missing")
}
const executable = (path: string, body: string): void => {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}`)
  chmodSync(path, 0o755)
}
const sandbox = (mode: "success" | "pack-failure" | "verify-failure" | "wait"): Sandbox => {
  const root = mkdtempSync(join(tmpdir(), "argus-pack-"))
  roots.push(root)
  const bin = join(root, "bin")
  mkdirSync(bin)
  mkdirSync(join(root, "scripts"))
  const manifest = join(root, "package.json")
  writeFileSync(manifest, originalManifest)
  writeFileSync(join(root, "output"), "")
  executable(
    join(bin, "timeout"),
    'if [ "$' + '{1:-}" = "--preserve-status" ]; then shift; fi\nshift\nexec "$@"\n',
  )
  executable(
    join(bin, "npm"),
    mode === "wait"
      ? 'kill -TERM "$PPID"\nexit 143\n'
      : mode === "pack-failure"
        ? "exit 23\n"
        : 'touch "$RUNNER_TEMP/release.tgz"\nprintf \'[{"filename":"release.tgz"}]\\n\'\n',
  )
  executable(
    join(bin, "bun"),
    mode === "verify-failure"
      ? 'if [ "$1" = "scripts/verify-release-tarball.ts" ]; then exit 29; fi\nexit 0\n'
      : 'if [ "$1" = "scripts/verify-release-tarball.ts" ]; then printf "%s/release.tgz" "$RUNNER_TEMP"; fi\n',
  )
  return {
    root,
    manifest,
    environment: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? tmpdir(),
      RUNNER_TEMP: root,
      GITHUB_OUTPUT: join(root, "output"),
      RELEASE_VERSION: "0.8.1",
      PACKAGE_NAME: "solidity-argus",
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
    },
  }
}
const run = (fixture: Sandbox) =>
  Bun.spawnSync(["bash", "-c", packScript()], {
    cwd: fixture.root,
    env: fixture.environment,
    stdout: "pipe",
    stderr: "pipe",
  })

describe("publish pack manifest restoration", () => {
  for (const mode of ["success", "pack-failure", "verify-failure"] as const) {
    test(`Given ${mode} When the pack block exits Then package.json is restored byte-for-byte`, () => {
      const fixture = sandbox(mode)
      const result = run(fixture)
      expect(result.exitCode === 0).toBe(mode === "success")
      expect(readFileSync(fixture.manifest, "utf8")).toBe(originalManifest)
    })
  }

  test("Given an in-flight pack When TERM interrupts it Then package.json is restored byte-for-byte", () => {
    const fixture = sandbox("wait")
    expect(run(fixture).exitCode).not.toBe(0)
    expect(readFileSync(fixture.manifest, "utf8")).toBe(originalManifest)
  })
})
