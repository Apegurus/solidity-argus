import { describe, expect, it } from "bun:test"
import { getTokenBudgetForAgent } from "./context-budget"

describe("getTokenBudgetForAgent", () => {
  it("returns 2000 for argus", () => {
    expect(getTokenBudgetForAgent("argus")).toBe(2000)
  })

  it("returns 1000 for sentinel", () => {
    expect(getTokenBudgetForAgent("sentinel")).toBe(1000)
  })

  it("returns 1000 for pythia", () => {
    expect(getTokenBudgetForAgent("pythia")).toBe(1000)
  })

  it("returns 1000 for scribe", () => {
    expect(getTokenBudgetForAgent("scribe")).toBe(1000)
  })

  it("returns 0 for non-argus agent", () => {
    expect(getTokenBudgetForAgent("build")).toBe(0)
  })

  it("returns 0 for unknown agent", () => {
    expect(getTokenBudgetForAgent("unknown-agent")).toBe(0)
  })

  it("reduces argus budget by 50% when pressure exceeds 70%", () => {
    expect(getTokenBudgetForAgent("argus", 0.75)).toBe(1000)
  })

  it("reduces subagent budget by 50% when pressure exceeds 70%", () => {
    expect(getTokenBudgetForAgent("sentinel", 0.8)).toBe(500)
    expect(getTokenBudgetForAgent("pythia", 0.85)).toBe(500)
    expect(getTokenBudgetForAgent("scribe", 0.99)).toBe(500)
  })

  it("returns full budget when pressure is at exactly 70%", () => {
    expect(getTokenBudgetForAgent("argus", 0.7)).toBe(2000)
    expect(getTokenBudgetForAgent("sentinel", 0.7)).toBe(1000)
  })

  it("returns full budget when pressure is below threshold", () => {
    expect(getTokenBudgetForAgent("argus", 0.5)).toBe(2000)
    expect(getTokenBudgetForAgent("sentinel", 0.1)).toBe(1000)
  })

  it("returns 0 for non-argus agent regardless of pressure", () => {
    expect(getTokenBudgetForAgent("build", 0.9)).toBe(0)
    expect(getTokenBudgetForAgent("code", 0.5)).toBe(0)
  })

  it("defaults contextPressure to 0 when omitted", () => {
    expect(getTokenBudgetForAgent("argus")).toBe(2000)
    expect(getTokenBudgetForAgent("sentinel")).toBe(1000)
  })
})
