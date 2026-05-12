import { expect, test } from "bun:test"
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
