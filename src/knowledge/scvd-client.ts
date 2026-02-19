export interface ScvdFinding {
  scvd_id: string;
  doc_id: string;
  title: string;
  description_md: string;
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational";
  taxonomy: { swc: string[]; cwe: string[] };
  repo: { url: string; commit?: string; lines?: [number, number] };
  sections: { recommendation_md?: string; poc_md?: string };
}

export interface ScvdStats {
  total: number;
  by_severity: Record<string, number>;
  last_updated: string;
}

const DEFAULT_PAGE_SIZE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function toNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      output[key] = rawValue;
    }
  }

  return output;
}

function parseLines(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined;
  }

  const start = value[0];
  const end = value[1];

  if (typeof start !== "number" || typeof end !== "number") {
    return undefined;
  }

  return [start, end];
}

function parseFinding(raw: unknown): ScvdFinding | null {
  if (!isRecord(raw)) {
    return null;
  }

  const taxonomyRaw = isRecord(raw.taxonomy) ? raw.taxonomy : {};
  const repoRaw = isRecord(raw.repo) ? raw.repo : {};
  const sectionsRaw = isRecord(raw.sections) ? raw.sections : {};

  const scvdId = raw.scvd_id;
  const docId = raw.doc_id;
  const title = raw.title;
  const description = raw.description_md;
  const severity = raw.severity;
  const repoUrl = repoRaw.url;

  if (
    typeof scvdId !== "string" ||
    typeof docId !== "string" ||
    typeof title !== "string" ||
    typeof description !== "string" ||
    typeof repoUrl !== "string"
  ) {
    return null;
  }

  if (
    severity !== "Critical" &&
    severity !== "High" &&
    severity !== "Medium" &&
    severity !== "Low" &&
    severity !== "Informational"
  ) {
    return null;
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
  };
}

function parseFindings(raw: unknown): ScvdFinding[] {
  if (!Array.isArray(raw)) {
    if (isRecord(raw) && Array.isArray(raw.data)) {
      return raw.data.map(parseFinding).filter((value): value is ScvdFinding => value !== null);
    }
    return [];
  }

  return raw.map(parseFinding).filter((value): value is ScvdFinding => value !== null);
}

function parseStats(raw: unknown): ScvdStats {
  if (!isRecord(raw)) {
    throw new Error("Invalid SCVD stats response payload");
  }

  const total = raw.total;
  const lastUpdated = raw.last_updated;

  if (typeof total !== "number" || typeof lastUpdated !== "string") {
    throw new Error("Invalid SCVD stats fields in response");
  }

  return {
    total,
    by_severity: toNumberRecord(raw.by_severity),
    last_updated: lastUpdated,
  };
}

export class ScvdNetworkError extends Error {
  override readonly name = "ScvdNetworkError" as const;

  constructor(message: string) {
    super(message);
  }
}

export class ScvdApiError extends Error {
  override readonly name = "ScvdApiError" as const;
  readonly httpStatus: number;

  constructor(httpStatus: number, message?: string) {
    super(message ?? `SCVD API error: HTTP ${httpStatus}`);
    this.httpStatus = httpStatus;
  }
}

export class ScvdClient {
  private readonly baseUrl: string;
  private readonly signal?: AbortSignal;

  constructor(apiUrl: string, signal?: AbortSignal) {
    this.baseUrl = apiUrl.replace(/\/$/, "");
    this.signal = signal;
  }

  async fetchStats(): Promise<ScvdStats> {
    const url = `${this.baseUrl}/stats`;

    let response: Response;
    try {
      response = await fetch(url, { signal: this.signal });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown network error";
      throw new ScvdNetworkError(`Failed to fetch SCVD stats from ${url}: ${message}`);
    }

    if (!response.ok) {
      throw new ScvdApiError(
        response.status,
        `Failed to fetch SCVD stats from ${url}: HTTP ${response.status}`
      );
    }

    const body = (await response.json()) as unknown;
    return parseStats(body);
  }

  async fetchFindings(params: {
    severity?: string;
    limit?: number;
    offset?: number;
  }): Promise<ScvdFinding[]> {
    const searchParams = new URLSearchParams();

    if (params.severity) {
      searchParams.set("severity", params.severity);
    }
    if (typeof params.limit === "number") {
      searchParams.set("limit", String(params.limit));
    }
    if (typeof params.offset === "number") {
      searchParams.set("offset", String(params.offset));
    }

    const query = searchParams.toString();
    const url = `${this.baseUrl}/findings${query.length > 0 ? `?${query}` : ""}`;

    let response: Response;
    try {
      response = await fetch(url, { signal: this.signal });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown network error";
      throw new ScvdNetworkError(`Failed to fetch SCVD findings from ${url}: ${message}`);
    }

    if (!response.ok) {
      throw new ScvdApiError(
        response.status,
        `SCVD API error: HTTP ${response.status} for ${url}`
      );
    }

    const body = (await response.json()) as unknown;
    return parseFindings(body);
  }

  async fetchAllFindings(onProgress?: (count: number) => void): Promise<ScvdFinding[]> {
    const results: ScvdFinding[] = [];
    let offset = 0;

    while (true) {
      const page = await this.fetchFindings({
        limit: DEFAULT_PAGE_SIZE,
        offset,
      });

      if (page.length === 0) {
        break;
      }

      results.push(...page);
      offset += page.length;

      if (onProgress) {
        onProgress(results.length);
      }

      if (page.length < DEFAULT_PAGE_SIZE) {
        break;
      }
    }

    return results;
  }
}
