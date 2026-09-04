import { hasBinary, parseSolcVersion } from "../shared/binary-utils"
import { buildSafeEnv } from "../shared/process-runner"
import {
  DEFAULT_SUBPROCESS_TIMEOUT_MS,
  MAX_SUBPROCESS_STDERR_BYTES,
  MAX_SUBPROCESS_STDOUT_BYTES,
  readStreamCapped,
} from "../shared/subprocess-io"
import type { RunSlitherCommand } from "./slither-tool"

export type SpawnFn = (
  command: string[],
  options?: { readonly cwd?: string; readonly timeout?: number },
) => Promise<{ readonly stdout: string; readonly exitCode: number }>

export type FlattenFallbackDeps = {
  readonly runCommand: RunSlitherCommand
  readonly hasBinary: (name: string) => boolean
  readonly ensureSolc: (version: string) => Promise<boolean>
  readonly parseSolcVersion: (target: string) => Promise<string | undefined> | string | undefined
  readonly spawnFn: SpawnFn
  readonly cwd: string
  readonly projectDir: string
}

async function ensureSolc(version: string): Promise<boolean> {
  if (hasBinary("solc")) return true
  if (!hasBinary("solc-select")) return false
  try {
    for (const command of [
      ["solc-select", "install", version],
      ["solc-select", "use", version],
    ]) {
      const proc = Bun.spawn(command, {
        stdout: "pipe",
        stderr: "pipe",
        signal: AbortSignal.timeout(30_000),
        env: buildSafeEnv(),
      })
      if ((await proc.exited) !== 0) return false
    }
    return true
  } catch {
    return false
  }
}

export async function defaultSpawnFn(
  command: string[],
  options?: { readonly cwd?: string; readonly timeout?: number },
): Promise<{ readonly stdout: string; readonly exitCode: number }> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: options?.cwd,
    timeout: options?.timeout ?? DEFAULT_SUBPROCESS_TIMEOUT_MS,
    env: buildSafeEnv(),
  })
  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    readStreamCapped(proc.stdout, MAX_SUBPROCESS_STDOUT_BYTES),
    readStreamCapped(proc.stderr, MAX_SUBPROCESS_STDERR_BYTES),
  ])
  if (stdout.truncated) {
    throw new Error(
      `subprocess stdout exceeded ${MAX_SUBPROCESS_STDOUT_BYTES} bytes; refusing to use truncated output`,
    )
  }
  return { stdout: stdout.text, exitCode }
}

export function defaultFlattenDeps(runCommand: RunSlitherCommand): FlattenFallbackDeps {
  return {
    runCommand,
    hasBinary,
    ensureSolc,
    parseSolcVersion,
    spawnFn: defaultSpawnFn,
    cwd: process.cwd(),
    projectDir: process.cwd(),
  }
}
