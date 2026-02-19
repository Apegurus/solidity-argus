import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { CliCommand } from "../types"
import { loadArgusConfig } from "../../config/loader"
import { getRequiredAuditSkills, resolveArgusSkills } from "../../skills/argus-skill-resolver"
import { detectViaIr } from "../../tools/slither-tool"

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

function checkBinary(name: string): { found: boolean; version: string | null } {
  try {
    const version = execSync(`${name} --version`, { timeout: 5000 })
      .toString()
      .trim()
      .split("\n")[0] ?? null
    return { found: true, version }
  } catch {
    return { found: false, version: null }
  }
}

function checkSolidityProject(dir: string): string | null {
  if (existsSync(join(dir, "foundry.toml"))) return "foundry"
  if (existsSync(join(dir, "hardhat.config.js"))) return "hardhat"
  if (existsSync(join(dir, "hardhat.config.ts"))) return "hardhat"
  return null
}

export const doctorCommand: CliCommand = {
  name: "doctor",
  description: "Check tool dependencies and configuration",
  async execute(args: string[]): Promise<number> {
    const cwd = process.cwd()
    let hasFailure = false

    console.log("Argus Doctor\n")

    const slither = checkBinary("slither")
    if (slither.found) {
      console.log(`${GREEN}✓${RESET} Slither: installed (${slither.version})`)
    } else {
      console.log(`${RED}✗${RESET} Slither: not found — pip install slither-analyzer`)
      hasFailure = true
    }

    const forge = checkBinary("forge")
    if (forge.found) {
      console.log(`${GREEN}✓${RESET} Forge: installed (${forge.version})`)
    } else {
      console.log(`${RED}✗${RESET} Forge: not found — curl -L https://foundry.paradigm.xyz | bash`)
      hasFailure = true
    }

    const solcSelect = checkBinary("solc-select")
    if (solcSelect.found) {
      console.log(`${GREEN}✓${RESET} solc-select: installed (${solcSelect.version})`)
    } else {
      console.log(`${YELLOW}⚠${RESET} solc-select: not found — pipx install solc-select (needed for via_ir flatten fallback)`)
    }

    const projectType = checkSolidityProject(cwd)
    if (projectType) {
      console.log(`${GREEN}✓${RESET} Project: ${projectType} detected`)
    } else {
      console.log(`${YELLOW}⚠${RESET} Project: no Solidity project detected`)
    }

    if (projectType === "foundry" && detectViaIr(cwd)) {
      console.log(`${YELLOW}⚠${RESET} via_ir: enabled in foundry.toml — Slither will use flatten fallback`)
      if (!forge.found) {
        console.log(`${RED}✗${RESET}   forge is required for via_ir flatten fallback but is missing`)
        hasFailure = true
      }
      if (!solcSelect.found) {
        console.log(`${YELLOW}⚠${RESET}   solc-select is recommended for via_ir flatten fallback`)
      }
    }

    try {
      const config = loadArgusConfig(cwd)
      console.log(`${GREEN}✓${RESET} Config: valid`)

      const requiredSkills = getRequiredAuditSkills()
      const resolvedSkills = resolveArgusSkills(cwd, config)
      const missingSkills = requiredSkills.filter((skillName) => !resolvedSkills.has(skillName))

      if (missingSkills.length === 0) {
        console.log(`${GREEN}✓${RESET} Skills: required audit skills resolvable (${requiredSkills.join(", ")})`)
      } else {
        console.log(`${RED}✗${RESET} Skills: missing required skills (${missingSkills.join(", ")})`)
        hasFailure = true
      }
    } catch {
      console.log(`${YELLOW}⚠${RESET} Config: using defaults`)

      const requiredSkills = getRequiredAuditSkills()
      const resolvedSkills = resolveArgusSkills(cwd)
      const missingSkills = requiredSkills.filter((skillName) => !resolvedSkills.has(skillName))

      if (missingSkills.length === 0) {
        console.log(`${GREEN}✓${RESET} Skills: required audit skills resolvable (${requiredSkills.join(", ")})`)
      } else {
        console.log(`${RED}✗${RESET} Skills: missing required skills (${missingSkills.join(", ")})`)
        hasFailure = true
      }
    }

    try {
      const response = await fetch("https://api.scvd.dev/stats", { signal: AbortSignal.timeout(5000) })
      if (response.ok) {
        console.log(`${GREEN}✓${RESET} SCVD API: reachable`)
      } else {
        console.log(`${YELLOW}⚠${RESET} SCVD API: returned ${response.status}`)
      }
    } catch {
      console.log(`${YELLOW}⚠${RESET} SCVD API: unreachable`)
    }

    return hasFailure ? 1 : 0
  },
}
