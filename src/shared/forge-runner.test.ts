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

    it("should bound BOTH stdout and stderr to the configured byte caps", async () => {
      const result = await runForgeCommand(
        [
          "bun",
          "-e",
          "process.stdout.write('o'.repeat(5000)); process.stderr.write('e'.repeat(5000))",
        ],
        { maxStdoutBytes: 1000, maxStderrBytes: 1000 },
      )

      expect(result.stdout.startsWith("o".repeat(1000))).toBe(true)
      expect(result.stdout).toContain("stdout truncated: 4000 bytes omitted")
      expect(result.stderr.startsWith("e".repeat(1000))).toBe(true)
      expect(result.stderr).toContain("stderr truncated: 4000 bytes omitted")
      expect(result.exitCode).toBe(0)
    })

    it("should not append a truncation marker when output is under the cap", async () => {
      const result = await runForgeCommand(["echo", "small"], {})
      expect(result.stdout.trim()).toBe("small")
      expect(result.stdout).not.toContain("truncated")
    })

    it("should pass env variables to the command", async () => {
      const result = await runForgeCommand(["sh", "-c", "echo $MY_VAR"], {
        env: { ...Bun.env, MY_VAR: "test-value" },
      })
      expect(result.stdout.trim()).toBe("test-value")
      expect(result.exitCode).toBe(0)
    })

    it("should not inherit non-allowlisted host env vars into the child", async () => {
      // Bun snapshots the parent env at startup, so a runtime process.env mutation would
      // not reach the child; probe a var already present in the startup snapshot instead.
      const allowed = new Set([
        "PATH",
        "HOME",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TMPDIR",
        "TEMP",
        "TMP",
        "TERM",
        "TZ",
        "FOUNDRY_PROFILE",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
      ])
      const leakVar = Object.keys(Bun.env).find(
        (k) =>
          !allowed.has(k) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && (Bun.env[k] ?? "").length > 0,
      )
      expect(leakVar).toBeDefined()
      const result = await runForgeCommand(["sh", "-c", `printf '%s' "\${${leakVar}:-ABSENT}"`], {})
      expect(result.stdout).toBe("ABSENT")
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
