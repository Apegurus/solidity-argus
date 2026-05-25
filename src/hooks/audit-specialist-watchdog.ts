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

export function createAuditSpecialistWatchdog(deps: {
  getAgentForSession: (sessionID: string) => string | undefined
}) {
  return async (input: TextCompleteInput, output: TextCompleteOutput): Promise<void> => {
    if (deps.getAgentForSession(input.sessionID) !== "audit-specialist") return

    const repeated = repeatedParagraph(output.text)
    if (!repeated) return

    throw new Error(
      `audit-specialist output repetition watchdog blocked stagnant output in message ${input.messageID}/${input.partID}: repeated paragraph "${repeated.slice(0, 120)}"`,
    )
  }
}
