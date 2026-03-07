export type ForgeCommandResult = {
  stdout: string
  stderr: string
  exitCode: number
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
    stderr,
    exitCode,
  }
}
