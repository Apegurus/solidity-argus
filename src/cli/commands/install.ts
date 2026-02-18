import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { CliCommand } from "../types"

const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

export function findOpencodeConfig(homeOverride?: string): string | null {
  const cwd = process.cwd()
  const localPath = join(cwd, "opencode.json")
  if (existsSync(localPath)) return localPath

  const home = homeOverride ?? homedir()
  const globalPath = join(home, ".config", "opencode", "opencode.json")
  if (existsSync(globalPath)) return globalPath

  return null
}

export const installCommand: CliCommand = {
  name: "install",
  description: "Register solidity-argus in your OpenCode config",
  async execute(args: string[]): Promise<number> {
    const configPath = findOpencodeConfig()

    if (!configPath) {
      console.error(`${YELLOW}⚠${RESET} opencode.json not found`)
      console.error("  Create one first, or run: opencode init")
      return 1
    }

    try {
      const content = readFileSync(configPath, "utf-8")
      const config = JSON.parse(content)
      const plugins: string[] = config.plugin ?? []

      if (plugins.includes("solidity-argus")) {
        console.log(`${GREEN}✓${RESET} solidity-argus already registered in ${configPath}`)
        return 0
      }

      plugins.push("solidity-argus")
      config.plugin = plugins
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

      console.log(`${GREEN}✓${RESET} Added solidity-argus to ${configPath}`)
      return 0
    } catch (error) {
      console.error(`${YELLOW}⚠${RESET} Failed to update ${configPath}`)
      return 1
    }
  },
}
