export interface ScvdFinding {
  scvd_id: string
  doc_id: string
  title: string
  description_md: string
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational"
  taxonomy: { swc: string[]; cwe: string[] }
  repo: { url: string; commit?: string; lines?: [number, number] }
  sections: { recommendation_md?: string; poc_md?: string }
}

export interface ScvdStats {
  total: number
  by_severity: Record<string, number>
  last_updated: string
}

export interface ScvdFindingsPage {
  findings: ScvdFinding[]
  nextCursor?: string
}

import { assertAllowedHost } from "../shared/process-runner"
import { isRecord } from "../shared/type-guards"

const DEFAULT_PAGE_SIZE = 100
const MAX_SCVD_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_SCVD_PAGES = 100
const MAX_SCVD_FINDINGS = 10_000

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === "string")
}

function toNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {}
  }

  const output: Record<string, number> = {}
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      output[key] = rawValue
    }
  }

  return output
}

function parseLines(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined
  }

  const start = value[0]
  const end = value[1]

  if (typeof start !== "number" || typeof end !== "number") {
    return undefined
  }

  return [start, end]
}

function parseFinding(raw: unknown): ScvdFinding | null {
  if (!isRecord(raw)) {
    return null
  }

  const taxonomyRaw = isRecord(raw.taxonomy) ? raw.taxonomy : {}
  const repoRaw = isRecord(raw.repo) ? raw.repo : {}
  const sectionsRaw = isRecord(raw.sections) ? raw.sections : {}

  const scvdId = raw.scvd_id
  const docId = raw.doc_id
  const title = raw.title
  // SCVD schema 0.1 leaves description_md null on ~half the corpus but always carries the
  // finding body under full_markdown; fall back so those findings are still indexed.
  const description =
    typeof raw.description_md === "string" && raw.description_md.length > 0
      ? raw.description_md
      : typeof raw.full_markdown === "string"
        ? raw.full_markdown
        : undefined
  const severity = raw.severity
  const repoUrl = repoRaw.url

  if (
    typeof scvdId !== "string" ||
    typeof docId !== "string" ||
    typeof title !== "string" ||
    typeof description !== "string" ||
    typeof repoUrl !== "string"
  ) {
    return null
  }

  if (
    severity !== "Critical" &&
    severity !== "High" &&
    severity !== "Medium" &&
    severity !== "Low" &&
    severity !== "Informational"
  ) {
    return null
  }

  return {
    scvd_id: scvdId,
    doc_id: docId,
    title,
    description_md: description,
    severity,
    taxonomy: {
      swc: toStringArray(taxonomyRaw.swc),
      cwe: toStringArray(taxonomyRaw.cwe),
    },
    repo: {
      url: repoUrl,
      commit: typeof repoRaw.commit === "string" ? repoRaw.commit : undefined,
      lines: parseLines(repoRaw.lines),
    },
    sections: {
      recommendation_md:
        typeof sectionsRaw.recommendation_md === "string"
          ? sectionsRaw.recommendation_md
          : undefined,
      poc_md: typeof sectionsRaw.poc_md === "string" ? sectionsRaw.poc_md : undefined,
    },
  }
}

function parseFindings(raw: unknown): ScvdFinding[] {
  if (Array.isArray(raw)) {
    return raw.map(parseFinding).filter((value): value is ScvdFinding => value !== null)
  }

  if (isRecord(raw)) {
    // SCVD schema 0.1 wraps the page in { items: [...] }; the legacy API used { data: [...] }.
    const container = Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.data)
        ? raw.data
        : null
    if (container) {
      return container.map(parseFinding).filter((value): value is ScvdFinding => value !== null)
    }
  }

  return []
}

function parseNextCursor(raw: unknown): string | undefined {
  if (isRecord(raw) && typeof raw.next_cursor === "string" && raw.next_cursor.length > 0) {
    return raw.next_cursor
  }
  return undefined
}

function parseBySeverity(value: unknown): Record<string, number> {
  // SCVD schema 0.1 returns [{ level, count }]; the legacy API returned { level: count }.
  if (Array.isArray(value)) {
    const output: Record<string, number> = {}
    for (const entry of value) {
      if (isRecord(entry) && typeof entry.level === "string" && typeof entry.count === "number") {
        output[entry.level] = entry.count
      }
    }
    return output
  }

  return toNumberRecord(value)
}

function parseStats(raw: unknown): ScvdStats {
  if (!isRecord(raw)) {
    throw new Error("Invalid SCVD stats response payload")
  }

  // SCVD schema 0.1: { totals: { findings }, by_severity: [{ level, count }] } and drops
  // last_updated. The legacy API used { total, last_updated, by_severity: { level: count } }.
  const totals = isRecord(raw.totals) ? raw.totals : null
  const total =
    typeof raw.total === "number"
      ? raw.total
      : typeof totals?.findings === "number"
        ? totals.findings
        : null

  if (total === null) {
    throw new Error("Invalid SCVD stats fields in response")
  }

  return {
    total,
    by_severity: parseBySeverity(raw.by_severity),
    last_updated: typeof raw.last_updated === "string" ? raw.last_updated : "",
  }
}

export class ScvdNetworkError extends Error {
  override readonly name = "ScvdNetworkError" as const
}

export class ScvdApiError extends Error {
  override readonly name = "ScvdApiError" as const
  readonly httpStatus: number

  constructor(httpStatus: number, message?: string) {
    super(message ?? `SCVD API error: HTTP ${httpStatus}`)
    this.httpStatus = httpStatus
  }
}

export function assertScvdApiUrlAllowed(apiUrl: string): void {
  assertAllowedHost(apiUrl)
}

// Read + JSON-parse a response body bounded to `maxBytes`, cancelling the download and rejecting
// once the cap is crossed — a remote (allowlisted but untrusted) mirror cannot exhaust memory with
// an unbounded body. JSON cannot be partially parsed, so this rejects rather than truncates.
export async function readJsonBodyCapped(
  response: Response,
  url: string,
  maxBytes: number = MAX_SCVD_RESPONSE_BYTES,
): Promise<unknown> {
  const stream = response.body
  if (!stream) {
    throw new ScvdNetworkError(`SCVD response from ${url} has no readable body to bound`)
  }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel()
      throw new ScvdNetworkError(`SCVD response from ${url} exceeded the ${maxBytes}-byte cap`)
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

export class ScvdClient {
  private readonly baseUrl: string
  private readonly signal?: AbortSignal

  constructor(apiUrl: string, signal?: AbortSignal) {
    this.baseUrl = apiUrl.replace(/\/$/, "")
    this.signal = signal
  }

  async fetchStats(): Promise<ScvdStats> {
    const url = `${this.baseUrl}/stats`

    let response: Response
    try {
      response = await fetch(url, { signal: this.signal })
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown network error"
      throw new ScvdNetworkError(`Failed to fetch SCVD stats from ${url}: ${message}`)
    }

    if (!response.ok) {
      throw new ScvdApiError(
        response.status,
        `Failed to fetch SCVD stats from ${url}: HTTP ${response.status}`,
      )
    }

    const body = await readJsonBodyCapped(response, url)
    return parseStats(body)
  }

  async fetchFindings(params: {
    severity?: string
    limit?: number
    cursor?: string
  }): Promise<ScvdFindingsPage> {
    const searchParams = new URLSearchParams()

    if (params.severity) {
      searchParams.set("severity", params.severity)
    }
    if (typeof params.limit === "number") {
      searchParams.set("limit", String(params.limit))
    }
    if (params.cursor) {
      searchParams.set("cursor", params.cursor)
    }

    const query = searchParams.toString()
    const url = `${this.baseUrl}/findings${query.length > 0 ? `?${query}` : ""}`

    let response: Response
    try {
      response = await fetch(url, { signal: this.signal })
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown network error"
      throw new ScvdNetworkError(`Failed to fetch SCVD findings from ${url}: ${message}`)
    }

    if (!response.ok) {
      throw new ScvdApiError(response.status, `SCVD API error: HTTP ${response.status} for ${url}`)
    }

    const body = await readJsonBodyCapped(response, url)
    return { findings: parseFindings(body), nextCursor: parseNextCursor(body) }
  }

  async fetchAllFindings(onProgress?: (count: number) => void): Promise<ScvdFinding[]> {
    const results: ScvdFinding[] = []
    let cursor: string | undefined
    let pagesFetched = 0
    const seenCursors = new Set<string>()

    // SCVD schema 0.1 uses opaque cursor pagination (next_cursor); offset is ignored. Stop on an
    // empty page, a missing/repeated cursor, or finite page/result caps.
    while (pagesFetched < MAX_SCVD_PAGES && results.length < MAX_SCVD_FINDINGS) {
      const page = await this.fetchFindings({ limit: DEFAULT_PAGE_SIZE, cursor })
      pagesFetched += 1

      if (page.findings.length === 0) {
        break
      }

      const remaining = MAX_SCVD_FINDINGS - results.length
      results.push(...page.findings.slice(0, remaining))
      onProgress?.(results.length)

      if (
        results.length === MAX_SCVD_FINDINGS ||
        !page.nextCursor ||
        seenCursors.has(page.nextCursor)
      ) {
        break
      }
      seenCursors.add(page.nextCursor)
      cursor = page.nextCursor
    }

    return results
  }
}
