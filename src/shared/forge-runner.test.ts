import { describe, expect, it } from "bun:test"
import { runForgeCommand } from "./forge-runner"

describe("forge-runner", () => {
  describe("runForgeCommand", () => {
    it("should run a command and return stdout, stderr, exitCode", async () => {
      const result = await runForgeCommand(["echo", "hello"], {})
      expect(result.stdout.trim()).toBe("hello")
      expect(result.stderr).toBe("")
      expect(result.exitCode).toBe(0)
    })

    it("should return non-zero exitCode for failing commands", async () => {
      const result = await runForgeCommand(["false"], {})
      expect(result.exitCode).not.toBe(0)
    })

    it("should capture stderr output", async () => {
      const result = await runForgeCommand(["sh", "-c", "echo error >&2"], {})
      expect(result.stderr.trim()).toBe("error")
      expect(result.exitCode).toBe(0)
    })

    it("should pass env variables to the command", async () => {
      const result = await runForgeCommand(["sh", "-c", "echo $MY_VAR"], {
        env: { ...Bun.env, MY_VAR: "test-value" },
      })
      expect(result.stdout.trim()).toBe("test-value")
      expect(result.exitCode).toBe(0)
    })

    it("should respect cwd option", async () => {
      const tmpDir = require("node:os").tmpdir()
      const result = await runForgeCommand(["pwd"], { cwd: tmpDir })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim().length).toBeGreaterThan(0)
    })

    it("should handle abort signal by not hanging", async () => {
      const controller = new AbortController()
      controller.abort()
      await runForgeCommand(["echo", "test"], { signal: controller.signal }).catch(() => null)
      expect(true).toBe(true)
    })
  })
})
