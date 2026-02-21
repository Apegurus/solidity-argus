/**
 * Context budget allocation for Argus agents.
 *
 * Provides per-agent token budgets for system-prompt injection sizing.
 * Under context pressure (>70%), budgets are reduced by 50% to prevent
 * context window overflow during long audits.
 *
 * Decoupled from system-prompt-hook.ts — consumed by the hook when available.
 */

const ARGUS_BUDGET = 2000
const SUBAGENT_BUDGET = 1000
const PRESSURE_THRESHOLD = 0.7
const PRESSURE_REDUCTION = 0.5

const ARGUS_AGENTS = new Set(["argus"])
const SUBAGENTS = new Set(["sentinel", "pythia", "scribe"])

/**
 * Returns the token budget for a given agent, adjusted for context pressure.
 *
 * @param agent - Agent name (e.g. "argus", "sentinel", "pythia", "scribe")
 * @param contextPressure - Current context usage ratio (0.0–1.0), from ContextMonitor
 * @returns Token budget in tokens. 0 for non-Argus agents.
 */
export function getTokenBudgetForAgent(agent: string, contextPressure: number = 0): number {
  let budget: number

  if (ARGUS_AGENTS.has(agent)) {
    budget = ARGUS_BUDGET
  } else if (SUBAGENTS.has(agent)) {
    budget = SUBAGENT_BUDGET
  } else {
    return 0
  }

  if (contextPressure > PRESSURE_THRESHOLD) {
    budget = Math.floor(budget * PRESSURE_REDUCTION)
  }

  return budget
}
