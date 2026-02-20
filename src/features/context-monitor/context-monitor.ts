import type { AuditState } from "../../state/types"
import { createLogger } from "../../shared/logger"

const DEFAULT_MAX_TOKENS = 200_000
const REMINDER_THRESHOLD = 0.70
const COMPACTION_THRESHOLD = 0.85

export interface ContextMonitorConfig {
  maxTokens?: number
}

export function createContextMonitor(config: ContextMonitorConfig = {}) {
  const logger = createLogger()
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS

  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  function getContextStatus(
    systemText: string,
    auditState: AuditState | null,
  ): { usage: number; reminder: string | null; shouldCompact: boolean } {
    const tokens = estimateTokens(systemText)
    const usage = tokens / maxTokens

    if (usage >= COMPACTION_THRESHOLD) {
      logger.info(`Context at ${Math.round(usage * 100)}% — triggering compaction`)
      return {
        usage,
        reminder: `[Argus Context Warning] Context window at ${Math.round(usage * 100)}%. Compaction triggered. Prioritize critical findings.`,
        shouldCompact: true,
      }
    }

    if (usage >= REMINDER_THRESHOLD) {
      return {
        usage,
        reminder: `[Argus Context Notice] Context at ${Math.round(usage * 100)}% — maintain audit thoroughness, be concise.`,
        shouldCompact: false,
      }
    }

    return { usage, reminder: null, shouldCompact: false }
  }

  return { estimateTokens, getContextStatus }
}
