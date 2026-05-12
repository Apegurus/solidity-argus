import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { cliOutput } from "../cli-output"
import { confirm } from "../tui-prompts"
import type { CliCommand } from "../types"

const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

function resolveHome(homeOverride?: string): string {
  if (homeOverride && homeOverride.length > 0) return homeOverride
  const envHome = process.env.HOME ?? process.env.USERPROFILE
  if (envHome && envHome.length > 0) return envHome
  return homedir()
}

function localConfigPath(): string {
  return join(process.cwd(), "opencode.json")
}

function globalConfigPath(homeOverride?: string): string {
  return join(resolveHome(homeOverride), ".config", "opencode", "opencode.json")
}

export function findOpencodeConfig(homeOverride?: string): string | null {
  const local = localConfigPath()
  if (existsSync(local)) return local

  const global = globalConfigPath(homeOverride)
  if (existsSync(global)) return global

  return null
}

function addPluginToConfig(configPath: string): { added: boolean; ok: boolean } {
  try {
    let config: Record<string, unknown>
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8")
      config = JSON.parse(content)
    } else {
      mkdirSync(dirname(configPath), { recursive: true })
      config = {}
    }

    const plugins = Array.isArray(config.plugin) ? (config.plugin as string[]) : []
    if (plugins.includes("solidity-argus")) {
      cliOutput.log(`${GREEN}✓${RESET} solidity-argus already registered in ${configPath}`)
      return { added: false, ok: true }
    }

    plugins.push("solidity-argus")
    config.plugin = plugins
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
    cliOutput.log(`${GREEN}✓${RESET} Added solidity-argus to ${configPath}`)
    return { added: true, ok: true }
  } catch (_error) {
    cliOutput.error(`${YELLOW}⚠${RESET} Failed to update ${configPath}`)
    return { added: false, ok: false }
  }
}

export const installCommand: CliCommand = {
  name: "install",
  description:
    "Register solidity-argus in your OpenCode config (use --global for ~/.config/opencode)",
  async execute(args: string[]): Promise<number> {
    const isGlobal = args.includes("--global") || args.includes("-g")
    const local = localConfigPath()

    if (existsSync(local) && !isGlobal) {
      return addPluginToConfig(local).ok ? 0 : 1
    }

    if (isGlobal) {
      return addPluginToConfig(globalConfigPath()).ok ? 0 : 1
    }

    const global = globalConfigPath()
    cliOutput.warn(
      `${YELLOW}⚠${RESET} No opencode.json found in current directory (${process.cwd()}).`,
    )
    cliOutput.warn(
      `  Installing globally would write to ${global} and load solidity-argus in EVERY OpenCode session.`,
    )
    cliOutput.warn(`  To install globally on purpose, re-run with: argus install --global`)
    cliOutput.warn(
      `  To install for this project, first create an opencode.json in this directory.`,
    )

    const proceed = await confirm("Install globally anyway?", false)
    if (!proceed) {
      cliOutput.log("Aborted. No changes made.")
      return 0
    }

    return addPluginToConfig(global).ok ? 0 : 1
  },
}
