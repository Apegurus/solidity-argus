import type { ScvdClient } from "./scvd-client";
import { ScvdApiError, ScvdNetworkError } from "./scvd-client";
import { createLogger } from "../shared/logger";
import {
  createApiError,
  createNetworkError,
  createParseError,
  createSyncSuccess,
  isRetryableError,
  type SyncError,
  type SyncOutcome,
} from "./scvd-errors";
import {
  acquireSyncLock,
  buildIndex,
  loadIndex,
  releaseSyncLock,
  saveIndex,
  type ScvdIndex,
  type ScvdIndexMetadata,
} from "./scvd-index";
import { withRetry } from "./retry";

export type SyncResult = SyncOutcome;

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

function buildErrorResult(error: unknown): SyncError {
  const message = error instanceof Error ? error.message : "Unknown sync error";

  if (error instanceof ScvdNetworkError) {
    return createNetworkError(message);
  }
  if (error instanceof ScvdApiError) {
    return createApiError(error.httpStatus, message);
  }
  return createParseError(message);
}

function shouldRetrySyncError(error: unknown): boolean {
  if (!(error instanceof ScvdNetworkError)) {
    return false;
  }

  return isRetryableError(buildErrorResult(error));
}

function errorReasonFromResult(result: SyncError): string {
  return result.reason;
}

async function persistErrorMetadata(
  indexPath: string,
  errorResult: SyncError
): Promise<void> {
  const existing = await loadIndex(indexPath);
  if (!existing) return;

  const now = new Date().toISOString();
  const prevMetadata = existing.metadata;
  existing.metadata = {
    lastSuccess: prevMetadata?.lastSuccess ?? null,
    lastAttempt: now,
    errorCount: (prevMetadata?.errorCount ?? 0) + 1,
    lastError: errorResult.message,
    lastErrorReason: errorReasonFromResult(errorResult),
  };
  await saveIndex(existing, indexPath);
}

async function syncAllUnlocked(client: ScvdClient, indexPath: string): Promise<SyncResult> {
  const fetchResult = await withRetry(() => client.fetchAllFindings(), {
    maxAttempts: RETRY_MAX_ATTEMPTS,
    baseDelayMs: RETRY_BASE_DELAY_MS,
    shouldRetry: shouldRetrySyncError,
  });

  if (!fetchResult.success) {
    const errorResult = buildErrorResult(fetchResult.error);
    errorResult.attempts = fetchResult.attempts;
    await persistErrorMetadata(indexPath, errorResult);
    return errorResult;
  }

  if (fetchResult.value === undefined) {
    const errorResult = createParseError("SCVD sync returned no findings payload");
    errorResult.attempts = fetchResult.attempts;
    await persistErrorMetadata(indexPath, errorResult);
    return errorResult;
  }

  const findings = fetchResult.value;
  const index = buildIndex(findings);
  const now = new Date().toISOString();
  index.metadata = {
    lastSuccess: now,
    lastAttempt: now,
    errorCount: 0,
    lastError: null,
    lastErrorReason: null,
  };
  await saveIndex(index, indexPath);

  return createSyncSuccess({
    newFindings: findings.length,
    totalIndexed: index.totalFindings,
    lastSync: index.lastSync,
    attempts: fetchResult.attempts,
  });
}

export async function syncAll(client: ScvdClient, indexPath: string): Promise<SyncResult> {
  const logger = createLogger();

  if (!acquireSyncLock()) {
    return createParseError("Sync already in progress");
  }

  logger.debug("[sync] starting", "source=scvd mode=full");

  try {
    const result = await syncAllUnlocked(client, indexPath);
    if (result.success) {
      logger.debug("[sync] complete", `source=scvd newFindings=${result.newFindings} totalIndexed=${result.totalIndexed}`);
    } else {
      const reason = result.status === "error" ? result.reason : result.status;
      logger.debug("[sync] failed", `source=scvd reason=${reason}`);
    }
    return result;
  } catch (error) {
    const errorResult = buildErrorResult(error);
    logger.debug("[sync] failed", `source=scvd reason=${errorResult.reason}`);
    await persistErrorMetadata(indexPath, errorResult).catch(() => {});
    return errorResult;
  } finally {
    releaseSyncLock();
  }
}

export async function syncIncremental(
  client: ScvdClient,
  indexPath: string
): Promise<SyncResult> {
  const logger = createLogger();

  if (!acquireSyncLock()) {
    return createParseError("Sync already in progress");
  }

  logger.debug("[sync] starting", "source=scvd mode=incremental");

  try {
    const [statsResult, existingIndex] = await Promise.all([
      withRetry(() => client.fetchStats(), {
        maxAttempts: RETRY_MAX_ATTEMPTS,
        baseDelayMs: RETRY_BASE_DELAY_MS,
        shouldRetry: shouldRetrySyncError,
      }),
      loadIndex(indexPath),
    ]);

    if (!statsResult.success) {
      const errorResult = buildErrorResult(statsResult.error);
      errorResult.attempts = statsResult.attempts;
      await persistErrorMetadata(indexPath, errorResult).catch(() => {});
      return errorResult;
    }

    if (statsResult.value === undefined) {
      const errorResult = createParseError("SCVD sync returned no stats payload");
      errorResult.attempts = statsResult.attempts;
      await persistErrorMetadata(indexPath, errorResult).catch(() => {});
      return errorResult;
    }

    const stats = statsResult.value;

    if (existingIndex && existingIndex.totalFindings === stats.total) {
      return createSyncSuccess({
        newFindings: 0,
        totalIndexed: existingIndex.totalFindings,
        lastSync: existingIndex.lastSync,
      });
    }

    return await syncAllUnlocked(client, indexPath);
  } catch (error) {
    const errorResult = buildErrorResult(error);
    await persistErrorMetadata(indexPath, errorResult).catch(() => {});
    return errorResult;
  } finally {
    releaseSyncLock();
  }
}
const STALE_THRESHOLD_DAYS = 7;

export function isSyncStale(
  index: ScvdIndex | null,
  thresholdDays: number = STALE_THRESHOLD_DAYS
): boolean {
  if (!index || !index.lastSync) return true;
  const lastSyncDate = new Date(index.lastSync);
  const now = new Date();
  const diffMs = now.getTime() - lastSyncDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > thresholdDays;
}

export async function getSyncStatus(indexPath: string): Promise<{
  lastSync: string | null;
  totalFindings: number;
  healthy: boolean;
  stale: boolean;
  metadata: ScvdIndexMetadata | null;
  hint?: string;
}> {
  const logger = createLogger();
  const index = await loadIndex(indexPath);

  if (!index) {
    return {
      lastSync: null,
      totalFindings: 0,
      healthy: false,
      stale: true,
      metadata: null,
      hint: "SCVD data is missing. Run argus_sync_knowledge to populate.",
    };
  }

  const stale = isSyncStale(index);

  if (stale) {
    const lastSyncDate = new Date(index.lastSync);
    const daysSince = Math.floor((Date.now() - lastSyncDate.getTime()) / (1000 * 60 * 60 * 24));
    logger.debug("[sync] stale", `source=scvd daysSince=${daysSince}`);

    return {
      lastSync: index.lastSync,
      totalFindings: index.totalFindings,
      healthy: true,
      stale: true,
      metadata: index.metadata ?? null,
      hint: "SCVD data is stale. Run argus_sync_knowledge to update.",
    };
  }

  return {
    lastSync: index.lastSync,
    totalFindings: index.totalFindings,
    healthy: true,
    stale: false,
    metadata: index.metadata ?? null,
  };
}
