import { expect, test } from "bun:test"
import {
  ARGUS_FAMILY,
  ARGUS_ORCHESTRATOR,
  ARGUS_SUBAGENTS,
  isArgusFamily,
  isOrchestratorAgent,
  isSubagent,
} from "./agent-names"

test("ARGUS_FAMILY contains all 4 agents", () => {
  expect(ARGUS_FAMILY).toEqual(new Set(["argus", "sentinel", "pythia", "scribe"]))
})

test("ARGUS_ORCHESTRATOR is argus", () => {
  expect(ARGUS_ORCHESTRATOR).toEqual(new Set(["argus"]))
})

test("ARGUS_SUBAGENTS excludes argus", () => {
  expect(ARGUS_SUBAGENTS).toEqual(new Set(["sentinel", "pythia", "scribe"]))
})

test("isArgusFamily checks membership", () => {
  expect(isArgusFamily("argus")).toBe(true)
  expect(isArgusFamily("sentinel")).toBe(true)
  expect(isArgusFamily("unknown")).toBe(false)
})

test("isOrchestratorAgent checks membership", () => {
  expect(isOrchestratorAgent("argus")).toBe(true)
  expect(isOrchestratorAgent("sentinel")).toBe(false)
})

test("isSubagent checks membership", () => {
  expect(isSubagent("sentinel")).toBe(true)
  expect(isSubagent("argus")).toBe(false)
})
