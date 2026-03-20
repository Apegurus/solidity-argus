export const ARGUS_ORCHESTRATOR = new Set(["argus"] as const)
export const ARGUS_SUBAGENTS = new Set(["sentinel", "pythia", "scribe"] as const)
export const ARGUS_FAMILY = new Set([...ARGUS_ORCHESTRATOR, ...ARGUS_SUBAGENTS])

export function isArgusFamily(agent: string): boolean {
  return ARGUS_FAMILY.has(agent)
}

export function isOrchestratorAgent(agent: string): boolean {
  return ARGUS_ORCHESTRATOR.has(agent)
}

export function isSubagent(agent: string): boolean {
  return ARGUS_SUBAGENTS.has(agent)
}
