import type { ScvdFinding } from "./scvd-client";

export interface ScvdIndexEntry {
  id: string;
  title: string;
  severity: string;
  swc: string[];
  cwe: string[];
  keywords: string[];
  repoUrl: string;
}

export interface ScvdIndexMetadata {
  lastSuccess: string | null;
  lastAttempt: string | null;
  errorCount: number;
  lastError: string | null;
  lastErrorReason: string | null;
}

export interface ScvdIndex {
  version: number;
  lastSync: string;
  totalFindings: number;
  entries: ScvdIndexEntry[];
  metadata?: ScvdIndexMetadata;
}

const INDEX_VERSION = 1;
const DEFAULT_LIMIT = 10;
let syncInProgress = false;

export function acquireSyncLock(): boolean {
  if (syncInProgress) {
    return false;
  }

  syncInProgress = true;
  return true;
}

export function releaseSyncLock(): void {
  syncInProgress = false;
}

export function isSyncLocked(): boolean {
  return syncInProgress;
}

function normalizeKeywordInput(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter((word) => word.length > 1);
}

function uniqueWords(words: string[]): string[] {
  return Array.from(new Set(words));
}

function findingToEntry(finding: ScvdFinding): ScvdIndexEntry {
  const keywordSource = `${finding.title} ${finding.description_md}`;

  return {
    id: finding.scvd_id,
    title: finding.title,
    severity: finding.severity,
    swc: finding.taxonomy.swc,
    cwe: finding.taxonomy.cwe,
    keywords: uniqueWords(normalizeKeywordInput(keywordSource)),
    repoUrl: finding.repo.url,
  };
}

export function buildIndex(findings: ScvdFinding[]): ScvdIndex {
  const now = new Date().toISOString();
  const entries = findings.map(findingToEntry);

  return {
    version: INDEX_VERSION,
    lastSync: now,
    totalFindings: entries.length,
    entries,
  };
}

export function searchIndex(
  index: ScvdIndex,
  query: {
    swc?: string;
    severity?: string;
    keyword?: string;
    limit?: number;
  }
): ScvdIndexEntry[] {
  const normalizedKeyword = query.keyword?.toLowerCase().trim();
  const limit = query.limit ?? DEFAULT_LIMIT;

  const filtered = index.entries.filter((entry) => {
    if (query.swc && !entry.swc.includes(query.swc)) {
      return false;
    }

    if (query.severity && entry.severity !== query.severity) {
      return false;
    }

    if (normalizedKeyword && normalizedKeyword.length > 0) {
      const matchesKeyword = entry.keywords.some((keyword) =>
        keyword.includes(normalizedKeyword)
      );

      if (!matchesKeyword) {
        return false;
      }
    }

    return true;
  });

  return filtered.slice(0, limit);
}

export async function saveIndex(index: ScvdIndex, filePath: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  try {
    await Bun.write(tmpPath, JSON.stringify(index, null, 2));
    const { renameSync } = await import("node:fs");
    renameSync(tmpPath, filePath);
  } finally {
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(tmpPath);
    } catch {
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function parseEntry(value: unknown): ScvdIndexEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  const title = value.title;
  const severity = value.severity;
  const repoUrl = value.repoUrl;

  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    typeof severity !== "string" ||
    typeof repoUrl !== "string"
  ) {
    return null;
  }

  return {
    id,
    title,
    severity,
    swc: parseStringArray(value.swc),
    cwe: parseStringArray(value.cwe),
    keywords: parseStringArray(value.keywords),
    repoUrl,
  };
}

function parseNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseMetadata(raw: Record<string, unknown>): ScvdIndexMetadata {
  return {
    lastSuccess: parseNullableString(raw.lastSuccess),
    lastAttempt: parseNullableString(raw.lastAttempt),
    errorCount: typeof raw.errorCount === "number" ? raw.errorCount : 0,
    lastError: parseNullableString(raw.lastError),
    lastErrorReason: parseNullableString(raw.lastErrorReason),
  };
}

export async function loadIndex(filePath: string): Promise<ScvdIndex | null> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    return null;
  }

  const raw = (await file.json()) as unknown;

  if (!isRecord(raw)) {
    return null;
  }

  const version = raw.version;
  const lastSync = raw.lastSync;
  const totalFindings = raw.totalFindings;
  const rawEntries = raw.entries;

  if (
    typeof version !== "number" ||
    typeof lastSync !== "string" ||
    typeof totalFindings !== "number" ||
    !Array.isArray(rawEntries)
  ) {
    return null;
  }

  const entries = rawEntries
    .map(parseEntry)
    .filter((entry): entry is ScvdIndexEntry => entry !== null);

  const index: ScvdIndex = {
    version,
    lastSync,
    totalFindings,
    entries,
  };

  const rawMetadata = raw.metadata;
  if (isRecord(rawMetadata)) {
    index.metadata = parseMetadata(rawMetadata);
  }

  return index;
}
