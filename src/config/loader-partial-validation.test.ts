import { beforeEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { LOG_FILE, resetLoggerSink } from "../shared/logger"
import { _mergeConfigs } from "./loader"

function getLogContent(): string {
  try {
    return existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf-8") : ""
  } catch {
    return ""
  }
}

describe("_mergeConfigs partial field validation", () => {
  let logBefore: string

  beforeEach(() => {
    resetLoggerSink()
    logBefore = getLogContent()
  })

  test("preserves valid fields when one field is invalid", () => {
    const config = _mergeConfigs(
      {
        disabled_hooks: "not-an-array",
        reporting: { severityThreshold: "high", gasAnalysis: true },
      },
      null,
    )

    expect(config.reporting.severityThreshold).toBe("high")
    expect(config.reporting.gasAnalysis).toBe(true)
    expect(config.disabled_hooks).toEqual([])

    const newLogs = getLogContent().slice(logBefore.length)
    expect(newLogs).toContain("[ERROR]")
    expect(newLogs).toContain("disabled_hooks")
  })

  test("returns defaults with ERROR log when all fields are invalid", () => {
    const config = _mergeConfigs(
      {
        disabled_hooks: "not-an-array",
        reporting: "not-an-object",
        solodit: 42,
      },
      null,
    )

    expect(config.disabled_hooks).toEqual([])
    expect(config.reporting.format).toBe("markdown")
    expect(config.reporting.severityThreshold).toBe("low")
    expect(config.solodit.enabled).toBe(true)

    const newLogs = getLogContent().slice(logBefore.length)
    expect(newLogs).toContain("[ERROR]")
  })

  test("returns full parsed config when all fields are valid", () => {
    const config = _mergeConfigs(
      {
        disabled_hooks: ["hook-a", "hook-b"],
        reporting: { severityThreshold: "high", gasAnalysis: true },
        solodit: { enabled: false, port: 9999 },
      },
      null,
    )

    expect(config.disabled_hooks).toEqual(["hook-a", "hook-b"])
    expect(config.reporting.severityThreshold).toBe("high")
    expect(config.reporting.gasAnalysis).toBe(true)
    expect(config.solodit.enabled).toBe(false)
    expect(config.solodit.port).toBe(9999)

    const newLogs = getLogContent().slice(logBefore.length)
    expect(newLogs).not.toContain("[ERROR]")
  })

  test("error message includes which specific field(s) are invalid", () => {
    _mergeConfigs(
      {
        disabled_hooks: "not-an-array",
        solodit: "not-an-object",
        reporting: { severityThreshold: "high" },
      },
      null,
    )

    const newLogs = getLogContent().slice(logBefore.length)
    expect(newLogs).toContain("disabled_hooks")
    expect(newLogs).toContain("solodit")
    expect(newLogs).not.toContain("'reporting'")
  })

  test("warns about unknown top-level keys (typos like disbled_hooks)", () => {
    const config = _mergeConfigs(
      {
        disbled_hooks: ["hook1"],
        disabled_hooks: ["hook2"],
      },
      null,
    )

    expect(config.disabled_hooks).toEqual(["hook2"])

    const newLogs = getLogContent().slice(logBefore.length)
    expect(newLogs).toContain("[WARN]")
    expect(newLogs).toContain("disbled_hooks")
  })

  test("warns about unknown top-level keys from project config", () => {
    _mergeConfigs(null, {
      unknownKey: "some-value",
      reporting: { severityThreshold: "high" },
    })

    const newLogs = getLogContent().slice(logBefore.length)
    expect(newLogs).toContain("[WARN]")
    expect(newLogs).toContain("unknownKey")
  })
})
