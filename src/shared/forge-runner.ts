import { buildSafeEnv } from "./process-runner"
import {
  appendTruncationMarker,
  DEFAULT_SUBPROCESS_TIMEOUT_MS,
  MAX_SUBPROCESS_STDERR_BYTES,
  MAX_SUBPROCESS_STDOUT_BYTES,
  readStreamCapped,
} from "./subprocess-io"

export type ForgeCommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export async function runForgeCommand(
  command: string[],
  options: {
    signal?: AbortSignal
    cwd?: string
    env?: Record<string, string>
    maxStdoutBytes?: number
    maxStderrBytes?: number
    timeoutMs?: number
  },
): Promise<ForgeCommandResult> {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    signal: options.signal,
    timeout: options.timeoutMs ?? DEFAULT_SUBPROCESS_TIMEOUT_MS,
    env: buildSafeEnv(options.env),
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    readStreamCapped(child.stdout, options.maxStdoutBytes ?? MAX_SUBPROCESS_STDOUT_BYTES),
    readStreamCapped(child.stderr, options.maxStderrBytes ?? MAX_SUBPROCESS_STDERR_BYTES),
  ])

  return {
    stdout: appendTruncationMarker(stdout, "stdout"),
    stderr: appendTruncationMarker(stderr, "stderr"),
    exitCode,
  }
}
