type TextCompleteInput = {
  sessionID: string
  messageID: string
  partID: string
}

type TextCompleteOutput = {
  text: string
}

const MIN_PARAGRAPH_LENGTH = 24
const REPEAT_THRESHOLD = 3
const HANDOFF_MARKER = "HANDOFF_JSON"

function normalizeParagraph(paragraph: string): string {
  return paragraph.toLowerCase().replace(/\s+/g, " ").trim()
}

function repeatedParagraph(text: string): string | undefined {
  const counts = new Map<string, number>()
  for (const paragraph of text.split(/\n\s*\n/)) {
    const normalized = normalizeParagraph(paragraph)
    if (normalized.length < MIN_PARAGRAPH_LENGTH) continue
    const nextCount = (counts.get(normalized) ?? 0) + 1
    if (nextCount >= REPEAT_THRESHOLD) return normalized
    counts.set(normalized, nextCount)
  }
  return undefined
}

function dedupeRepeatedParagraphs(text: string): string {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const paragraph of text.split(/\n\s*\n/)) {
    const normalized = normalizeParagraph(paragraph)
    if (normalized.length >= MIN_PARAGRAPH_LENGTH) {
      if (seen.has(normalized)) continue
      seen.add(normalized)
    }
    kept.push(paragraph.trimEnd())
  }
  return kept.join("\n\n").trimEnd()
}

function ensureStructuredHandoff(text: string): string {
  if (text.includes(HANDOFF_MARKER)) return text
  return `${text}\n\n${HANDOFF_MARKER}\n{\n  "findings_recorded_ids": [],\n  "leads_not_recorded": [],\n  "tools_run": [],\n  "tool_failures": [],\n  "escalations_for_argus": ["audit-specialist watchdog recovered repeated output; review the de-duplicated handoff"],\n  "human_readable_brief": "Repeated trailing output was collapsed so the specialist turn could complete."\n}`
}

export function recoverAuditSpecialistOutput(text: string): string | undefined {
  const repeated = repeatedParagraph(text)
  if (!repeated) return undefined
  return ensureStructuredHandoff(dedupeRepeatedParagraphs(text))
}

export function createAuditSpecialistWatchdog(deps: {
  getAgentForSession: (sessionID: string) => string | undefined
}) {
  return async (
    input: TextCompleteInput,
    output: TextCompleteOutput,
  ): Promise<string | undefined> => {
    if (deps.getAgentForSession(input.sessionID) !== "audit-specialist") return

    const recovered = recoverAuditSpecialistOutput(output.text)
    if (!recovered) return undefined
    output.text = recovered
    return recovered
  }
}
