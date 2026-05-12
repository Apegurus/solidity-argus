import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { cliOutput } from "../cli-output"
import type { CliCommand } from "../types"

const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

const DEFAULT_CONFIG = {
  agents: {},
  tools: {},
  knowledge: { scvd: { enabled: true }, autoSync: true },
  reporting: { format: "markdown", severityThreshold: "low" },
  solodit: { enabled: true },
}

export const initCommand: CliCommand = {
  name: "init",
  description: "Initialize Argus configuration for this project",
  async execute(_args: string[]): Promise<number> {
    const cwd = process.cwd()
    const configDir = join(cwd, ".argus")
    const configPath = join(configDir, "solidity-argus.json")

    if (existsSync(configPath)) {
      cliOutput.error(
        `${YELLOW}⚠${RESET} Config already exists: ${configPath} — remove it first if you want to reinitialize.`,
      )
      return 1
    }

    mkdirSync(configDir, { recursive: true })
    writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`)

    const projectType = existsSync(join(cwd, "foundry.toml"))
      ? "Foundry"
      : existsSync(join(cwd, "hardhat.config.js")) || existsSync(join(cwd, "hardhat.config.ts"))
        ? "Hardhat"
        : "unknown"

    cliOutput.log(`${GREEN}✓${RESET} Created ${configPath}`)
    cliOutput.log(`  Project type: ${projectType}`)
    cliOutput.log("  Run 'argus doctor' to check dependencies.")

    return 0
  },
}
