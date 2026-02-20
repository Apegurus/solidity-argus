export type Severity = "critical" | "high" | "medium" | "low" | "info"

export interface ExtractedFinding {
  title: string
  severity: Severity
  description: string
  recommendation: string
  category: string
  source_pdf: string
  page: number
}

const HEADING_PATTERNS = [
  /^(?:Issue|Finding|Vulnerability|Risk)[_\s-]?\d{1,3}\b.{0,180}$/i,
  /^(?:Issue|Finding|Vulnerability|Risk)[_\s-]?\d{1,3}\s*[:\-].{3,180}$/i,
  /^Issue[_\s-]\d{1,3}\s+.+$/i,
  /^[CHMLI]-\d{1,3}\s*[:\-]\s*.+$/,
]

const SEVERITY_REGEX = /\bSeverity\s*[:\t ]+(Critical|High|Medium|Low|Informational|Info)\b/i

const DESCRIPTION_REGEX = /\bDescription\s*[:\t ]+([\s\S]{20,4000}?)(?=\n\s*(?:Recommendations?|Resolution|Severity|Status)\b|$)/i
const RECOMMENDATION_REGEX = /\bRecommendations?\s*[:\t ]+([\s\S]{10,4000}?)(?=\n\s*(?:Resolution|Status|Severity)\b|$)/i

export function normalizeSeverity(input: string): Severity {
  const value = input.trim().toLowerCase()
  if (value.startsWith("critical") || value === "c") {
    return "critical"
  }

  if (value.startsWith("high") || value === "h") {
    return "high"
  }

  if (value.startsWith("medium") || value === "m") {
    return "medium"
  }

  if (value.startsWith("low") || value === "l") {
    return "low"
  }

  return "info"
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim()
}

function inferSeverityFromHeading(heading: string): Severity | null {
  const match = heading.match(/^([CHMLI])-\d{1,3}\b/)
  if (!match) {
    return null
  }

  const code = match[1]
  if (!code) {
    return null
  }

  return normalizeSeverity(code)
}

function looksLikeHeading(line: string): boolean {
  const cleaned = line.trim()
  if (cleaned.length < 8 || cleaned.length > 220) {
    return false
  }

  return HEADING_PATTERNS.some((pattern) => pattern.test(cleaned))
}

function cleanHeadingTitle(heading: string): string {
  return normalizeWhitespace(
    heading
      .replace(/^[CHMLI]-\d{1,3}\s*[:\-]\s*/i, "")
      .replace(/^(?:Issue|Finding|Vulnerability|Risk)[_\s-]?\d{1,3}\s*[:\-]?\s*/i, "")
      .replace(/^Issue[_\s-]\d{1,3}\s+/i, "")
      .replace(/^\**\s*/, "")
      .replace(/\s*\**$/, ""),
  )
}

function extractDescription(blockText: string): string {
  const direct = blockText.match(DESCRIPTION_REGEX)
  if (direct?.[1]) {
    return normalizeWhitespace(direct[1])
  }

  const fallback = blockText
    .replace(/\bSeverity\s*[:\t ]+.+/gi, "")
    .replace(/\bRecommendations?\s*[:\t ]+[\s\S]*/gi, "")
    .replace(/^\s*(?:Issue|Finding|Vulnerability|Risk)[^\n]*$/gim, "")
    .trim()

  return normalizeWhitespace(fallback).slice(0, 900)
}

function extractRecommendation(blockText: string): string {
  const direct = blockText.match(RECOMMENDATION_REGEX)
  if (direct?.[1]) {
    return normalizeWhitespace(direct[1])
  }

  return "Review and remediate according to secure smart-contract best practices."
}

function categorizeFinding(title: string, description: string): string {
  const corpus = `${title} ${description}`.toLowerCase()
  const categories: Array<{ category: string; patterns: RegExp[] }> = [
    { category: "reentrancy", patterns: [/reentran/i] },
    { category: "access-control", patterns: [/access control/i, /unauthori/i, /onlyowner/i, /privilege/i, /admin/i] },
    { category: "oracle", patterns: [/oracle/i, /price feed/i, /chainlink/i, /twap/i, /stale/i] },
    { category: "integer-overflow-underflow", patterns: [/overflow/i, /underflow/i, /arithmetic/i] },
    { category: "dos", patterns: [/denial of service/i, /dos/i, /griefing/i] },
    { category: "input-validation", patterns: [/validation/i, /saniti/i, /unchecked/i, /zero address/i] },
    { category: "configuration", patterns: [/misconfig/i, /config/i, /parameter/i, /initializ/i] },
    { category: "tokenomics", patterns: [/mint/i, /burn/i, /inflation/i, /share/i, /supply/i] },
    { category: "upgradeability", patterns: [/upgrade/i, /proxy/i, /implementation/i, /initializer/i] },
    { category: "logic", patterns: [/logic/i, /state/i, /invariant/i, /rounding/i] },
  ]

  for (const entry of categories) {
    if (entry.patterns.some((pattern) => pattern.test(corpus))) {
      return entry.category
    }
  }

  return "general"
}

function buildFinding(
  heading: string,
  blockText: string,
  sourcePdf: string,
  pageNumber: number,
): ExtractedFinding | null {
  const severityMatch = blockText.match(SEVERITY_REGEX)
  const severityToken = severityMatch?.[1]
  const severity = severityToken ? normalizeSeverity(severityToken) : inferSeverityFromHeading(heading)
  if (!severity) {
    return null
  }

  const title = cleanHeadingTitle(heading)
  const description = extractDescription(blockText)
  if (!title || !description) {
    return null
  }

  const recommendation = extractRecommendation(blockText)
  const category = categorizeFinding(title, description)

  return {
    title,
    severity,
    description,
    recommendation,
    category,
    source_pdf: sourcePdf,
    page: pageNumber,
  }
}

export function parseFindingsFromPageText(pageText: string, sourcePdf: string, pageNumber: number): ExtractedFinding[] {
  const lines = pageText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)

  const findings: ExtractedFinding[] = []
  let currentHeading: string | null = null
  let currentBlock: string[] = []

  const flush = (): void => {
    if (!currentHeading) {
      currentBlock = []
      return
    }

    const blockText = currentBlock.join("\n")
    const finding = buildFinding(currentHeading, blockText, sourcePdf, pageNumber)
    if (finding) {
      findings.push(finding)
    }

    currentHeading = null
    currentBlock = []
  }

  for (const line of lines) {
    if (looksLikeHeading(line)) {
      flush()
      currentHeading = line.trim()
      currentBlock.push(line)
      continue
    }

    if (currentHeading) {
      currentBlock.push(line)
    }
  }

  flush()
  return findings
}

function findingKey(finding: ExtractedFinding): string {
  return `${finding.title}|${finding.severity}`
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, "")
}

export function dedupeFindings(findings: ExtractedFinding[]): ExtractedFinding[] {
  const seen = new Set<string>()
  const unique: ExtractedFinding[] = []

  for (const finding of findings) {
    const key = findingKey(finding)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(finding)
  }

  return unique
}
