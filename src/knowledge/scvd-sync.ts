import type { ScvdClient } from "./scvd-client";
import { buildIndex, loadIndex, saveIndex } from "./scvd-index";

export interface SyncResult {
  success: boolean;
  newFindings: number;
  totalIndexed: number;
  lastSync: string;
  error?: string;
}

function buildErrorResult(error: unknown): SyncResult {
  const message = error instanceof Error ? error.message : "Unknown sync error";
  return {
    success: false,
    newFindings: 0,
    totalIndexed: 0,
    lastSync: new Date().toISOString(),
    error: message,
  };
}

export async function syncAll(client: ScvdClient, indexPath: string): Promise<SyncResult> {
  try {
    const findings = await client.fetchAllFindings();
    const index = buildIndex(findings);
    await saveIndex(index, indexPath);

    return {
      success: true,
      newFindings: findings.length,
      totalIndexed: index.totalFindings,
      lastSync: index.lastSync,
    };
  } catch (error) {
    return buildErrorResult(error);
  }
}

export async function syncIncremental(
  client: ScvdClient,
  indexPath: string
): Promise<SyncResult> {
  try {
    const [stats, existingIndex] = await Promise.all([
      client.fetchStats(),
      loadIndex(indexPath),
    ]);

    if (existingIndex && existingIndex.totalFindings === stats.total) {
      return {
        success: true,
        newFindings: 0,
        totalIndexed: existingIndex.totalFindings,
        lastSync: existingIndex.lastSync,
      };
    }

    return await syncAll(client, indexPath);
  } catch (error) {
    return buildErrorResult(error);
  }
}

export async function getSyncStatus(indexPath: string): Promise<{
  lastSync: string | null;
  totalFindings: number;
  healthy: boolean;
}> {
  const index = await loadIndex(indexPath);

  if (!index) {
    return {
      lastSync: null,
      totalFindings: 0,
      healthy: false,
    };
  }

  return {
    lastSync: index.lastSync,
    totalFindings: index.totalFindings,
    healthy: true,
  };
}
