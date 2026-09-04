import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertContained,
  isContained,
  PathSafetyError,
  safeForgeMatchPath,
  safeForgeTarget,
  validateRunId,
  validateSessionId,
} from "./path-safety"

let root = ""
let outside = ""

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "argus-ps-root-"))
  outside = mkdtempSync(join(tmpdir(), "argus-ps-out-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

// --- containment: lexical parity with the module it replaces ---

test("assertContained allows a subdirectory and returns a canonical path", () => {
  mkdirSync(join(root, "src", "contracts"), { recursive: true })
  const resolved = assertContained(join(root, "src", "contracts"), root)
  expect(resolved.endsWith(join("src", "contracts"))).toBe(true)
})

test("assertContained allows the root itself", () => {
  expect(() => assertContained(root, root)).not.toThrow()
})

test("assertContained rejects lexical .. traversal", () => {
  expect(() => assertContained(join(root, "..", "etc"), root)).toThrow(PathSafetyError)
})

test("assertContained allows a not-yet-existing write target under root", () => {
  // Given: a path whose final components do not exist yet (a write target).
  const target = join(root, "runs", "run-1", "events.jsonl")
  // Then: nearest-existing-ancestor canonicalization still proves containment.
  expect(assertContained(target, root).endsWith(join("runs", "run-1", "events.jsonl"))).toBe(true)
})

// --- the WS-1 security property: symlink escape (lexical containment MISSES this) ---

test("assertContained rejects a path via an in-root symlink that escapes root (existing target)", () => {
  // Given: an in-root symlink `escape` -> an external directory holding a secret.
  writeFileSync(join(outside, "secret.txt"), "top-secret")
  symlinkSync(outside, join(root, "escape"))
  // When/Then: a lexically-inside path that resolves outside is rejected.
  expect(() => assertContained(join(root, "escape", "secret.txt"), root)).toThrow(PathSafetyError)
})

test("assertContained rejects an escaping symlink even when the final component does not exist", () => {
  // Given: an in-root symlink to an external dir; the target file does not exist.
  symlinkSync(outside, join(root, "escape"))
  // When/Then: canonicalizing the existing symlink prefix still detects the escape.
  expect(() => assertContained(join(root, "escape", "new-file.json"), root)).toThrow(
    PathSafetyError,
  )
})

test("isContained is the fail-closed boolean form", () => {
  symlinkSync(outside, join(root, "escape"))
  mkdirSync(join(root, "inside"))
  expect(isContained(join(root, "escape", "x"), root)).toBe(false)
  expect(isContained(join(root, "inside"), root)).toBe(true)
})

// --- identifier component validation ---

test("validateRunId accepts machine-generated ids", () => {
  for (const id of ["run-2026-07-01", "ses_abc123", "a1b2c3d4", "20260701T120000.123Z"]) {
    expect(validateRunId(id)).toBe(id)
  }
})

test("validateRunId rejects traversal / separators / empty / absolute / NUL / leading dot", () => {
  for (const bad of ["", "..", ".", "../x", "a/b", "a\\b", "/abs", "a..b", "a\0b", ".hidden"]) {
    expect(() => validateRunId(bad)).toThrow(PathSafetyError)
  }
})

test("validateSessionId enforces the same component rules", () => {
  expect(validateSessionId("ses_ok-1")).toBe("ses_ok-1")
  expect(() => validateSessionId("../escape")).toThrow(PathSafetyError)
})

// --- forge target normalizer ---

test("safeForgeTarget defaults to the project root when no target is given", () => {
  const resolved = safeForgeTarget(root)
  expect(resolved.length).toBeGreaterThan(0)
  expect(isContained(resolved, root)).toBe(true)
})

test("safeForgeTarget rejects an out-of-tree target", () => {
  expect(() => safeForgeTarget(root, outside)).toThrow(PathSafetyError)
})

test("safeForgeTarget accepts an in-tree target", () => {
  mkdirSync(join(root, "contracts"))
  expect(() => safeForgeTarget(root, join(root, "contracts"))).not.toThrow()
})

test("safeForgeMatchPath returns undefined when no match path is given", () => {
  expect(safeForgeMatchPath(root)).toBeUndefined()
})

test("safeForgeMatchPath returns a project-relative path for an in-tree match", () => {
  mkdirSync(join(root, "test"))
  expect(safeForgeMatchPath(root, "test/Foo.t.sol")).toBe(join("test", "Foo.t.sol"))
})

test("safeForgeMatchPath preserves glob segments", () => {
  mkdirSync(join(root, "test"))
  expect(safeForgeMatchPath(root, "test/**/*.t.sol")).toBe(join("test", "**", "*.t.sol"))
})

test("safeForgeMatchPath rejects absolute, traversal, and flag-shaped values", () => {
  for (const bad of ["/etc/passwd", "../../etc", "test/../../escape", "--fork-url"]) {
    expect(() => safeForgeMatchPath(root, bad)).toThrow(PathSafetyError)
  }
})
