export const ARGUS_ORCHESTRATOR: ReadonlySet<string> = new Set(["argus"])
export const ARGUS_SUBAGENTS: ReadonlySet<string> = new Set([
  "sentinel",
  "pythia",
  "scribe",
  "themis",
])
export const ARGUS_FAMILY: ReadonlySet<string> = new Set([
  ...ARGUS_ORCHESTRATOR,
  ...ARGUS_SUBAGENTS,
])

export function isArgusFamily(agent: string): boolean {
  return ARGUS_FAMILY.has(agent)
}

export function isOrchestratorAgent(agent: string): boolean {
  return ARGUS_ORCHESTRATOR.has(agent)
}

export function isSubagent(agent: string): boolean {
  return ARGUS_SUBAGENTS.has(agent)
}
