import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { createReplayDriver } from "./drivers/replay-driver"
import { loadFixture, runFixture } from "./runner"

describe("replay driver", () => {
  test("demotes recorded value-extraction finding without forge net-gain proof", async () => {
    const fixtureDir = join(import.meta.dir, "fixtures", "vulnerable-vault")
    const fixture = loadFixture(fixtureDir)
    const metrics = await runFixture({ fixture, driver: createReplayDriver() })
    const drain = metrics.matches.find(
      (match) => match.predicted.check === "reentrancy-eth-vault-drain",
    )?.predicted

    expect(drain?.rubric_verdict).toBe("DEMOTED")
    expect(drain?.tier).toBe("lead")
    expect(metrics.verdict_mismatches).toHaveLength(0)
  })
})
