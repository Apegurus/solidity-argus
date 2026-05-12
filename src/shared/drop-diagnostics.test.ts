import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createDropDiagnosticsCollector } from "./drop-diagnostics"
import { resetLoggerSink } from "./logger"

describe("createDropDiagnosticsCollector — log level mapping", () => {
  let stderrOutput: string[]
  let origWrite: typeof process.stderr.write
  let origEnv: string | undefined

  beforeEach(() => {
    stderrOutput = []
    origWrite = process.stderr.write
    process.stderr.write = (chunk: string | Uint8Array, ..._args: unknown[]) => {
      stderrOutput.push(String(chunk))
      return true
    }
    origEnv = process.env.ARGUS_LOG
    process.env.ARGUS_LOG = "stderr"
    resetLoggerSink()
  })

  afterEach(() => {
    process.stderr.write = origWrite
    if (origEnv === undefined) {
      delete process.env.ARGUS_LOG
    } else {
      process.env.ARGUS_LOG = origEnv
    }
    resetLoggerSink()
  })

  it("error-level diagnostic calls logger.error (logs [ERROR])", () => {
    const collector = createDropDiagnosticsCollector("warn", "test-source")
    collector.error("ERR001", "something went wrong")

    expect(stderrOutput.length).toBe(1)
    expect(stderrOutput[0]).toContain("[ERROR]")
    expect(stderrOutput[0]).not.toContain("[WARN]")
    expect(stderrOutput[0]).toContain("ERR001")
  })

  it("warn-level diagnostic calls logger.warn (logs [WARN])", () => {
    const collector = createDropDiagnosticsCollector("warn", "test-source")
    collector.warn("WARN001", "something is suspicious")

    expect(stderrOutput.length).toBe(1)
    expect(stderrOutput[0]).toContain("[WARN]")
    expect(stderrOutput[0]).not.toContain("[INFO]")
    expect(stderrOutput[0]).toContain("WARN001")
  })

  it("error-level diagnostic does NOT call logger.warn", () => {
    const collector = createDropDiagnosticsCollector("warn", "test-source")
    collector.error("ERR002", "critical failure")

    expect(stderrOutput.length).toBe(1)
    expect(stderrOutput[0]).not.toContain("[WARN]")
  })

  it("warn-level diagnostic does NOT call logger.info", () => {
    const collector = createDropDiagnosticsCollector("warn", "test-source")
    collector.warn("WARN002", "minor issue")

    expect(stderrOutput.length).toBe(1)
    expect(stderrOutput[0]).not.toContain("[INFO]")
  })
})
