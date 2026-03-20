import { test, expect } from "bun:test"
import { formatError } from "./format-error"

test("formats Error instances", () => {
  expect(formatError(new Error("boom"))).toBe("boom")
})

test("formats strings", () => {
  expect(formatError("oops")).toBe("oops")
})

test("formats numbers", () => {
  expect(formatError(42)).toBe("42")
})

test("formats null", () => {
  expect(formatError(null)).toBe("null")
})

test("formats undefined", () => {
  expect(formatError(undefined)).toBe("undefined")
})
