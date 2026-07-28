import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { createArgusPipelineDriver } from "./drivers/argus-pipeline-driver"
import { loadFixture, runFixture } from "./runner"

describe("Argus pipeline driver", () => {
  test("Given a retained vulnerable control When audited Then the persisted prediction is measured", async () => {
    const fixture = loadFixture(join(import.meta.dir, "fixtures", "scanner-retained-control"))
    const metrics = await runFixture({
      fixture,
      driver: createArgusPipelineDriver({ patterns: ["oracle-manipulation"] }),
    })

    expect(metrics.true_positives).toBe(1)
    expect(metrics.false_positives).toBe(0)
    expect(metrics.false_negatives).toBe(0)
    expect(metrics.recall).toBe(1)
    expect(metrics.matches[0]?.predicted).toMatchObject({
      check: "pyth-oracle-validation-rule-1",
      severity: "High",
      source: "pattern",
    })
  })

  test("Given an allowlisted forwarding control When audited Then removed feature-presence rules stay silent", async () => {
    const fixture = loadFixture(join(import.meta.dir, "fixtures", "scanner-safe-control"))
    const metrics = await runFixture({
      fixture,
      driver: createArgusPipelineDriver({ patterns: ["access-control"] }),
    })

    expect(metrics.false_positives).toBe(0)
    expect(metrics.unmatched_predicted).toHaveLength(0)
  })

  test("Given concurrent fixture audits When executed Then each run remains isolated", async () => {
    const fixture = loadFixture(join(import.meta.dir, "fixtures", "scanner-retained-control"))
    const listenersBefore = process.listenerCount("exit")
    const [first, second] = await Promise.all([
      runFixture({
        fixture,
        driver: createArgusPipelineDriver({ patterns: ["oracle-manipulation"] }),
      }),
      runFixture({
        fixture,
        driver: createArgusPipelineDriver({ patterns: ["oracle-manipulation"] }),
      }),
    ])

    expect(first.true_positives).toBe(1)
    expect(second.true_positives).toBe(1)
    expect(process.listenerCount("exit")).toBe(listenersBefore)
  })

  test("Given a category with no scanner rules When audited Then the driver rejects the vacuous result", async () => {
    const fixture = loadFixture(join(import.meta.dir, "fixtures", "scanner-safe-control"))

    await expect(
      createArgusPipelineDriver({ patterns: ["missing-category"] }).audit(fixture),
    ).rejects.toThrow("selected zero scanner patterns")
  })
})
