export type ForgeCommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

const MAX_STDERR_CHARS = 200_000

function boundStderr(stderr: string): string {
  if (stderr.length <= MAX_STDERR_CHARS) return stderr
  return `${stderr.slice(0, MAX_STDERR_CHARS)}\n[stderr truncated: ${stderr.length - MAX_STDERR_CHARS} chars omitted]`
}

export async function runForgeCommand(
  command: string[],
  options: { signal?: AbortSignal; cwd?: string; env?: Record<string, string> },
): Promise<ForgeCommandResult> {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    signal: options.signal,
    env: options.env,
  })

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  return {
    stdout,
    stderr: boundStderr(stderr),
    exitCode,
  }
}
