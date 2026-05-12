import { expect, test } from "bun:test"
import { assertContained, isContained, validateUrlScheme } from "./path-containment"

test("isContained allows subdirectories", () => {
  expect(isContained("/project/src/contracts", "/project")).toBe(true)
})

test("isContained rejects traversal", () => {
  expect(isContained("/project/../etc/passwd", "/project")).toBe(false)
})

test("isContained rejects sibling directories", () => {
  expect(isContained("/other-project/src", "/project")).toBe(false)
})

test("isContained allows the root itself", () => {
  expect(isContained("/project", "/project")).toBe(true)
})

test("assertContained throws on traversal", () => {
  expect(() => assertContained("../../etc", "/project")).toThrow("outside")
})

test("validateUrlScheme accepts http", () => {
  expect(validateUrlScheme("http://localhost:8545")).toBe(true)
})

test("validateUrlScheme accepts https", () => {
  expect(validateUrlScheme("https://mainnet.infura.io/v3/key")).toBe(true)
})

test("validateUrlScheme rejects non-http schemes", () => {
  expect(validateUrlScheme("file:///etc/passwd")).toBe(false)
})

test("validateUrlScheme rejects schemeless strings", () => {
  expect(validateUrlScheme("not-a-url")).toBe(false)
})
