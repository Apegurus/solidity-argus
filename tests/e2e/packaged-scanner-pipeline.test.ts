import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

const REPO_ROOT = join(import.meta.dir, "..", "..")
const RUNNER = join(import.meta.dir, "fixtures", "packaged-scanner-runner.ts")
const sandboxes: string[] = []

const ResultSchema = z.object({
  vulnerableMatches: z.array(z.object({ pattern: z.string(), severity: z.string() })),
  safeMatches: z.number(),
  bulkDisplayedMatches: z.number(),
  bulkTotalMatches: z.number(),
})

function run(
  command: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync([...command], { cwd, env, stdout: "pipe", stderr: "pipe" })
}

function expectSuccess(result: ReturnType<typeof Bun.spawnSync>): void {
  const stderr = new TextDecoder().decode(result.stderr)
  if (result.exitCode !== 0) throw new Error(stderr)
}

function bulkControl(): string {
  const reads = Array.from(
    { length: 60 },
    (_, index) =>
      `    function read${index}(bytes32 id) internal view returns (int64) { return pyth.getPriceUnsafe(id).price; }`,
  ).join("\n")
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
contract PythBulk {
    IPyth private immutable pyth;
    constructor(IPyth pyth_) { pyth = pyth_; }
${reads}
}
`
}

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true })
})

describe("installed package scanner pipeline", () => {
  test("Given the packed package When controls are scanned Then scanner precision survives installation", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "argus-packaged-scanner-"))
    sandboxes.push(sandbox)
    const packDir = join(sandbox, "pack")
    const consumerDir = join(sandbox, "consumer")
    mkdirSync(packDir)
    mkdirSync(join(consumerDir, "controls", "bulk"), { recursive: true })

    expectSuccess(
      run(["bun", "pm", "pack", "--ignore-scripts", "--destination", packDir], REPO_ROOT),
    )
    const archiveName = readdirSync(packDir).find((entry) => entry.endsWith(".tgz"))
    if (!archiveName) throw new Error("bun pm pack did not create a tarball")
    const archive = join(packDir, archiveName)

    writeFileSync(
      join(consumerDir, "package.json"),
      JSON.stringify({ name: "argus-packaged-e2e", private: true, type: "module" }),
    )
    expectSuccess(run(["bun", "add", "--offline", "--ignore-scripts", archive], consumerDir))
    cpSync(
      join(REPO_ROOT, "tests", "fixtures", "scanner-controls", "vulnerable"),
      join(consumerDir, "controls", "vulnerable"),
      { recursive: true },
    )
    cpSync(
      join(REPO_ROOT, "tests", "fixtures", "scanner-controls", "safe"),
      join(consumerDir, "controls", "safe"),
      { recursive: true },
    )
    writeFileSync(join(consumerDir, "controls", "bulk", "PythBulk.sol"), bulkControl())
    cpSync(RUNNER, join(consumerDir, "run.ts"))

    const executed = run(["bun", "run.ts"], consumerDir, {
      ...process.env,
      ARGUS_CACHE_DIR: join(sandbox, "cache"),
      ARGUS_LOG_FILE: join(sandbox, "argus.log"),
    })
    expectSuccess(executed)
    const result = ResultSchema.parse(JSON.parse(new TextDecoder().decode(executed.stdout)))

    expect(result.vulnerableMatches).toContainEqual({
      pattern: "pyth-oracle-validation-rule-1",
      severity: "High",
    })
    expect(result.safeMatches).toBe(0)
    expect(result.bulkDisplayedMatches).toBe(50)
    expect(result.bulkTotalMatches).toBe(60)
  })
})
