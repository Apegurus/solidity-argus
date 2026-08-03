import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { runTrusted } from "../../shared/process-runner"

export type SlitherPythonRuntime =
  | { readonly status: "supported"; readonly version: string }
  | { readonly status: "compatibility-warning"; readonly version: string }
  | { readonly status: "unknown" }

function resolvePythonInterpreter(slitherPath: string): string | null {
  const firstLine = readFileSync(slitherPath, "utf8").split(/\r?\n/, 1)[0] ?? ""
  if (!firstLine.startsWith("#!")) return null

  const parts = firstLine.slice(2).trim().split(/\s+/)
  let interpreter = parts[0]
  if (interpreter && basename(interpreter) === "env") {
    const envArgs = parts.slice(1)
    if (envArgs[0] === "-S") envArgs.shift()
    interpreter = envArgs.find((part) => !part.startsWith("-"))
  }
  if (!interpreter || !/^python(?:\d+(?:\.\d+)?)?$/.test(basename(interpreter))) return null
  return interpreter
}

function resolveCommandPath(command: string, cwd: string): string | null {
  if (command.includes("/")) return command
  const result = runTrusted({
    cmd: ["which", command],
    cwd,
    timeoutMs: 5_000,
    maxOutputBytes: 4_096,
  })
  return result.code === 0 ? (result.stdout.trim().split("\n", 1)[0] ?? null) : null
}

export function inspectSlitherPythonRuntime(
  slitherCommand: string,
  cwd: string,
): SlitherPythonRuntime {
  try {
    const slitherPath = resolveCommandPath(slitherCommand, cwd)
    if (!slitherPath) return { status: "unknown" }
    const interpreter = resolvePythonInterpreter(slitherPath)
    if (!interpreter) return { status: "unknown" }
    const result = runTrusted({
      cmd: [interpreter, "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"],
      cwd,
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
    })
    const version = result.stdout.trim()
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
    if (result.code !== 0 || !match) return { status: "unknown" }
    const major = Number(match[1])
    const minor = Number(match[2])
    return major === 3 && minor >= 14
      ? { status: "compatibility-warning", version }
      : { status: "supported", version }
  } catch {
    return { status: "unknown" }
  }
}
