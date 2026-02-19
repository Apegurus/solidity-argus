import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createLogger, resetLoggerSink, LOG_DIR } from "./logger"

describe("logger", () => {
  const originalEnv = process.env.ARGUS_LOG

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ARGUS_LOG
    } else {
      process.env.ARGUS_LOG = originalEnv
    }
    resetLoggerSink()
  })

  describe("file sink (default)", () => {
    it("writes to log file, not stderr", () => {
      delete process.env.ARGUS_LOG
      resetLoggerSink()

      const stderrOutput: string[] = []
      const origWrite = process.stderr.write
      process.stderr.write = (chunk: any) => {
        stderrOutput.push(String(chunk))
        return true
      }

      const logger = createLogger()
      logger.info("file-sink-test")

      process.stderr.write = origWrite

      expect(stderrOutput.length).toBe(0)

      const logPath = join(LOG_DIR, "argus.log")
      if (existsSync(logPath)) {
        const content = readFileSync(logPath, "utf-8")
        expect(content).toContain("file-sink-test")
        expect(content).toContain("[INFO]")
      }
    })
  })

  describe("stderr sink (ARGUS_LOG=stderr)", () => {
    let stderrOutput: string[]
    let origWrite: typeof process.stderr.write

    beforeEach(() => {
      stderrOutput = []
      origWrite = process.stderr.write
      process.stderr.write = (chunk: any) => {
        stderrOutput.push(String(chunk))
        return true
      }
      process.env.ARGUS_LOG = "stderr"
      resetLoggerSink()
    })

    afterEach(() => {
      process.stderr.write = origWrite
    })

    it("writes info to stderr with ISO timestamp and level", () => {
      const logger = createLogger()
      logger.info("test message")

      expect(stderrOutput.length).toBe(1)
      expect(stderrOutput[0]).toContain("[INFO]")
      expect(stderrOutput[0]).toContain("test message")
    })

    it("suppresses debug when debug=false", () => {
      const logger = createLogger({ debug: false })
      logger.debug("debug message")

      expect(stderrOutput.length).toBe(0)
    })

    it("writes debug when debug=true", () => {
      const logger = createLogger({ debug: true })
      logger.debug("debug message")

      expect(stderrOutput.length).toBe(1)
      expect(stderrOutput[0]).toContain("[DEBUG]")
      expect(stderrOutput[0]).toContain("debug message")
    })

    it("writes error with ERROR level", () => {
      const logger = createLogger()
      logger.error("error message")

      expect(stderrOutput.length).toBe(1)
      expect(stderrOutput[0]).toContain("[ERROR]")
      expect(stderrOutput[0]).toContain("error message")
    })

    it("writes warn with WARN level", () => {
      const logger = createLogger()
      logger.warn("warn message")

      expect(stderrOutput.length).toBe(1)
      expect(stderrOutput[0]).toContain("[WARN]")
      expect(stderrOutput[0]).toContain("warn message")
    })

    it("handles multiple arguments", () => {
      const logger = createLogger()
      logger.info("message", "with", "multiple", "args")

      expect(stderrOutput.length).toBe(1)
      expect(stderrOutput[0]).toContain("message")
      expect(stderrOutput[0]).toContain("with")
    })

    it("formats non-string args as JSON", () => {
      const logger = createLogger()
      logger.info("data:", { key: "value" })

      expect(stderrOutput.length).toBe(1)
      expect(stderrOutput[0]).toContain('{"key":"value"}')
    })
  })
})
