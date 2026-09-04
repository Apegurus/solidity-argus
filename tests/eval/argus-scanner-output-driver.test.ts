import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createArgusScannerOutputDriver } from "./drivers/argus-scanner-output-driver"
import { loadFixture, runFixture } from "./runner"
import type { FixtureManifest } from "./types"

describe("Argus scanner-output driver", () => {
  test("Given a retained vulnerable control When scanned Then the matching hint is measured", async () => {
    const fixture = loadFixture(join(import.meta.dir, "fixtures", "scanner-retained-control"))
    const metrics = await runFixture({
      fixture,
      driver: createArgusScannerOutputDriver({ patterns: ["oracle-manipulation"] }),
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
      driver: createArgusScannerOutputDriver({ patterns: ["access-control"] }),
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
        driver: createArgusScannerOutputDriver({ patterns: ["oracle-manipulation"] }),
      }),
      runFixture({
        fixture,
        driver: createArgusScannerOutputDriver({ patterns: ["oracle-manipulation"] }),
      }),
    ])

    expect(first.true_positives).toBe(1)
    expect(second.true_positives).toBe(1)
    expect(process.listenerCount("exit")).toBe(listenersBefore)
  })

  test("Given a category with no scanner rules When audited Then the driver rejects the vacuous result", async () => {
    const fixture = loadFixture(join(import.meta.dir, "fixtures", "scanner-safe-control"))

    await expect(
      createArgusScannerOutputDriver({ patterns: ["missing-category"] }).audit(fixture),
    ).rejects.toThrow("selected zero scanner patterns")
  })

  test("Given more matches than the display cap When audited Then every scanner match is measured", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "argus-eval-full-detail-"))
    try {
      const projectRoot = join(repoRoot, "bulk")
      mkdirSync(projectRoot)
      const reads = Array.from(
        { length: 60 },
        (_, index) =>
          `function read${index}(bytes32 id) internal view returns (int64) { return pyth.getPriceUnsafe(id).price; }`,
      ).join("\n")
      writeFileSync(
        join(projectRoot, "PythBulk.sol"),
        `pragma solidity ^0.8.20;
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
contract PythBulk {
  IPyth private immutable pyth;
  constructor(IPyth pyth_) { pyth = pyth_; }
  ${reads}
}`,
      )
      const fixture: FixtureManifest = {
        slug: "scanner-full-detail-control",
        name: "Scanner full-detail control",
        description: "Deterministic control above the compact display cap.",
        source: { name: "solidity-argus internal fixture", license: "MIT" },
        project: { root: "bulk", contracts_glob: "**/*.sol", foundry: false },
        expected_findings: [],
      }

      const result = await createArgusScannerOutputDriver({
        patterns: ["oracle-manipulation"],
        repoRoot,
      }).audit(fixture)

      expect(result.predicted).toHaveLength(60)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
