import { describe, expect, test } from "bun:test"
import { ArgusConfigSchema } from "../../src/config/schema"

describe("reporting.confidenceThreshold config", () => {
  test("default is 80 when reporting block is omitted entirely", () => {
    const parsed = ArgusConfigSchema.parse({})
    expect(parsed.reporting?.confidenceThreshold).toBe(80)
  })

  test("default is 80 when reporting block is provided without confidenceThreshold", () => {
    const parsed = ArgusConfigSchema.parse({ reporting: {} })
    expect(parsed.reporting?.confidenceThreshold).toBe(80)
  })

  test("custom threshold in valid range is accepted", () => {
    const r = ArgusConfigSchema.safeParse({
      reporting: { confidenceThreshold: 60 },
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.reporting?.confidenceThreshold).toBe(60)
  })

  test("threshold of 0 is accepted (edge of range)", () => {
    const r = ArgusConfigSchema.safeParse({
      reporting: { confidenceThreshold: 0 },
    })
    expect(r.success).toBe(true)
  })

  test("threshold of 100 is accepted (edge of range)", () => {
    const r = ArgusConfigSchema.safeParse({
      reporting: { confidenceThreshold: 100 },
    })
    expect(r.success).toBe(true)
  })

  test("threshold < 0 is rejected", () => {
    const r = ArgusConfigSchema.safeParse({
      reporting: { confidenceThreshold: -1 },
    })
    expect(r.success).toBe(false)
  })

  test("threshold > 100 is rejected", () => {
    const r = ArgusConfigSchema.safeParse({
      reporting: { confidenceThreshold: 101 },
    })
    expect(r.success).toBe(false)
  })

  test("non-integer threshold is rejected", () => {
    const r = ArgusConfigSchema.safeParse({
      reporting: { confidenceThreshold: 50.5 },
    })
    expect(r.success).toBe(false)
  })
})
