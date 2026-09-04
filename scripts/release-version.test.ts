import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"

const script = "scripts/release-version.ts"

type CommandResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

function run(...args: readonly string[]): CommandResult {
  const result = Bun.spawnSync(["bun", script, ...args], { stdout: "pipe", stderr: "pipe" })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  }
}

describe("release version CLI", () => {
  test("Given staging identity When deriving a version Then it is immutable and normalized", async () => {
    // Given
    const manifestBefore = await readFile("package.json", "utf8")

    // When
    const result = run("staging", "123", "80F693BCA1234567890", "0.8.0")

    // Then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("0.8.0-dev.123.g80f693b\n")
    expect(result.stderr).toBe("")
    expect(await readFile("package.json", "utf8")).toBe(manifestBefore)
  })

  test("Given main identity When deriving a version Then it is the exact stable version", () => {
    // Given / When
    const result = run("main", "123", "80f693bca1234567890", "0.8.0")

    // Then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("0.8.0\n")
    expect(result.stderr).toBe("")
  })

  test("Given an exactly seven-character SHA When deriving staging Then all seven characters are used", () => {
    // Given / When
    const result = run("staging", "123", "ABCDEF0", "0.8.0")

    // Then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("0.8.0-dev.123.gabcdef0\n")
    expect(result.stderr).toBe("")
  })

  test.each([
    ["branch", ["feature", "123", "80f693bca1234567890", "0.8.0"]],
    ["run ID", ["staging", "0", "80f693bca1234567890", "0.8.0"]],
    ["run ID", ["staging", "1.5", "80f693bca1234567890", "0.8.0"]],
    ["SHA", ["staging", "123", "not-a-sha", "0.8.0"]],
    ["stable version", ["main", "123", "80f693bca1234567890", "0.8.0-rc.1"]],
    ["arguments", ["main", "123", "80f693bca1234567890", "0.8.0", "extra"]],
  ])("Given invalid %s When invoked Then it fails clearly", (label, args) => {
    // Given / When
    const result = run(...args)

    // Then
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(label)
  })
})
