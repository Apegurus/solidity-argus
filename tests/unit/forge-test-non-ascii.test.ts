import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findNonAsciiSolidityDiagnostics } from "../../src/tools/forge-test-tool"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe("forge test non-ASCII diagnostics", () => {
  test("reports a precise file:line:col diagnostic for an em dash in Solidity source", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "argus-forge-ascii-"))
    tempDirs.push(projectDir)
    const testDir = join(projectDir, "test")
    await mkdir(testDir)
    const source = join(projectDir, "test", "Foo.t.sol")
    await Bun.write(
      source,
      'pragma solidity ^0.8.20;\n\ncontract Foo {\n    string constant MESSAGE = "boom — here";\n}\n',
    )

    const diagnostics = await findNonAsciiSolidityDiagnostics(projectDir, projectDir)

    expect(diagnostics).toEqual(["non-ASCII at test/Foo.t.sol:4:37 (U+2014 '—')"])
  })
})
