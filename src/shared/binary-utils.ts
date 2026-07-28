import { existsSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "./logger"
import { buildSafeEnv } from "./process-runner"

const logger = createLogger()

export function hasBinary(name: string): boolean {
  try {
    const { PATH } = buildSafeEnv()
    if (!PATH) return false
    return Bun.which(name, { PATH }) !== null
  } catch (_e) {
    return false
  }
}

export async function parseSolcVersion(target: string): Promise<string | undefined> {
  const foundryToml = join(target, "foundry.toml")
  if (await Bun.file(foundryToml).exists()) {
    const content = await Bun.file(foundryToml).text()
    const match = content.match(/solc\s*=\s*["']([^"']+)["']/)
    if (match?.[1]) return match[1]
  }

  const solFiles: string[] = []
  if (target.endsWith(".sol") && (await Bun.file(target).exists())) {
    solFiles.push(target)
  } else {
    const srcDir = join(target, "src")
    if (existsSync(srcDir)) {
      try {
        const proc = Bun.spawn(["find", srcDir, "-maxdepth", "3", "-name", "*.sol"], {
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.timeout(10_000),
          env: buildSafeEnv(),
        })
        const exitCode = await proc.exited
        if (exitCode === 0) {
          const output = await new Response(proc.stdout).text()
          solFiles.push(...output.trim().split("\n").filter(Boolean))
        }
      } catch (_findErr) {
        logger.debug("find command failed for .sol files")
      }
    }
  }

  for (const file of solFiles) {
    if (!file.endsWith(".sol") || !(await Bun.file(file).exists())) continue
    try {
      const content = await Bun.file(file).text()
      const pragma = content.match(/pragma\s+solidity\s+[\^~>=<]*\s*([\d.]+)/)
      if (pragma?.[1]) return pragma[1]
    } catch (_readErr) {
      logger.debug("Failed to read .sol file for pragma detection")
    }
  }
  return undefined
}

export async function extractContractNames(filePath: string): Promise<string[]> {
  if (!(await Bun.file(filePath).exists())) return []
  try {
    const content = await Bun.file(filePath).text()
    const matches = content.matchAll(/\b(?:contract|library|interface)\s+(\w+)/g)
    return Array.from(matches, (m) => m[1]).filter(Boolean) as string[]
  } catch (_e) {
    return []
  }
}
