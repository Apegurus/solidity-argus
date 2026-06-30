import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { normalizeFilePath } from "./path-utils"

test("strips projectDir prefix from absolute path", () => {
  expect(normalizeFilePath("/Users/dev/project/src/Vault.sol", "/Users/dev/project")).toBe(
    "src/Vault.sol",
  )
})

test("preserves already-relative path", () => {
  expect(normalizeFilePath("src/Vault.sol", "/Users/dev/project")).toBe("src/Vault.sol")
})

test("handles trailing slash on projectDir", () => {
  expect(normalizeFilePath("/Users/dev/project/src/Vault.sol", "/Users/dev/project/")).toBe(
    "src/Vault.sol",
  )
})

test("strips leading ./ from relative path", () => {
  expect(normalizeFilePath("./src/Vault.sol", "/any")).toBe("src/Vault.sol")
})

test("handles empty string", () => {
  expect(normalizeFilePath("", "/any")).toBe("")
})

test("preserves path that escapes project root", () => {
  expect(normalizeFilePath("/other/place/Vault.sol", "/Users/dev/project")).toBe(
    "/other/place/Vault.sol",
  )
})

test("resolves a unique nested suffix for relative findings", () => {
  const dir = mkdtempSync(join(tmpdir(), "argus-path-utils-"))
  try {
    const nested = join(dir, "tests", "fixtures", "vulnerable-vault", "src")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, "VulnerableVault.sol"), "contract VulnerableVault {}")

    const canonical = "tests/fixtures/vulnerable-vault/src/VulnerableVault.sol"
    expect(normalizeFilePath("src/VulnerableVault.sol", dir)).toBe(canonical)
    expect(normalizeFilePath("VulnerableVault.sol", dir)).toBe(canonical)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("preserves ambiguous suffix paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "argus-path-utils-"))
  try {
    const first = join(dir, "a", "src")
    const second = join(dir, "b", "src")
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    writeFileSync(join(first, "Vault.sol"), "contract Vault {}")
    writeFileSync(join(second, "Vault.sol"), "contract Vault {}")

    expect(normalizeFilePath("src/Vault.sol", dir)).toBe("src/Vault.sol")
    expect(normalizeFilePath("Vault.sol", dir)).toBe("Vault.sol")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("does not traverse symlinked directories during suffix resolution", () => {
  const dir = mkdtempSync(join(tmpdir(), "argus-path-utils-"))
  try {
    const real = join(dir, "real", "src")
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, "Vault.sol"), "contract Vault {}")
    symlinkSync(join(dir, "real"), join(dir, "linked"), "dir")

    expect(normalizeFilePath("src/Vault.sol", dir)).toBe("real/src/Vault.sol")
    expect(normalizeFilePath("linked/src/Vault.sol", dir)).toBe("linked/src/Vault.sol")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
