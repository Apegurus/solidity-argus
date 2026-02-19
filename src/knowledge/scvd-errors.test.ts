import { describe, expect, test } from "bun:test";
import {
  createApiError,
  createNetworkError,
  createParseError,
  createSyncSuccess,
  isRetryableError,
  type SyncError,
  type SyncOutcome,
  type SyncStale,
  type SyncSuccess,
} from "./scvd-errors";

describe("SCVD Error Classification", () => {
  test("createNetworkError returns error with reason 'network'", () => {
    const result = createNetworkError("connection refused");

    expect(result.status).toBe("error");
    expect(result.reason).toBe("network");
    expect(result.message).toContain("connection refused");
    expect(result.success).toBe(false);
    expect(result.error).toBe(result.message);
    expect(result.newFindings).toBe(0);
    expect(result.totalIndexed).toBe(0);
    expect(result.lastSync.length).toBeGreaterThan(0);
  });

  test("createApiError returns error with HTTP status and reason 'api'", () => {
    const result = createApiError(500, "Internal Server Error");

    expect(result.status).toBe("error");
    expect(result.reason).toBe("api");
    expect(result.httpStatus).toBe(500);
    expect(result.message).toContain("Internal Server Error");
    expect(result.success).toBe(false);
    expect(result.error).toBe(result.message);
  });

  test("createParseError returns error with reason 'parse'", () => {
    const result = createParseError("Invalid JSON payload");

    expect(result.status).toBe("error");
    expect(result.reason).toBe("parse");
    expect(result.message).toContain("Invalid JSON payload");
    expect(result.success).toBe(false);
    expect(result.error).toBe(result.message);
    expect(result.httpStatus).toBeUndefined();
  });

  test("createSyncSuccess returns success outcome with provided data", () => {
    const result = createSyncSuccess({
      newFindings: 42,
      totalIndexed: 7769,
      lastSync: "2026-02-19T00:00:00.000Z",
    });

    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.newFindings).toBe(42);
    expect(result.totalIndexed).toBe(7769);
    expect(result.lastSync).toBe("2026-02-19T00:00:00.000Z");
    expect(result.error).toBeUndefined();
  });

  test("isRetryableError returns true for network, false for api/parse/success", () => {
    const networkErr = createNetworkError("timeout");
    const apiErr = createApiError(500, "server error");
    const parseErr = createParseError("bad json");
    const success = createSyncSuccess({
      newFindings: 0,
      totalIndexed: 0,
      lastSync: "2026-02-19T00:00:00.000Z",
    });

    expect(isRetryableError(networkErr)).toBe(true);
    expect(isRetryableError(apiErr)).toBe(false);
    expect(isRetryableError(parseErr)).toBe(false);
    expect(isRetryableError(success)).toBe(false);
  });

  test("SyncOutcome discriminated union narrows on status field", () => {
    const outcomes: SyncOutcome[] = [
      createNetworkError("fail"),
      createSyncSuccess({
        newFindings: 1,
        totalIndexed: 1,
        lastSync: "2026-02-19T00:00:00.000Z",
      }),
      {
        status: "stale",
        success: false,
        newFindings: 0,
        totalIndexed: 0,
        lastSync: "2026-01-01T00:00:00.000Z",
        daysSinceSync: 49,
      } satisfies SyncStale,
    ];

    for (const outcome of outcomes) {
      switch (outcome.status) {
        case "error": {
          const err: SyncError = outcome;
          expect(err.reason).toBeDefined();
          expect(err.message).toBeDefined();
          break;
        }
        case "success": {
          const ok: SyncSuccess = outcome;
          expect(ok.newFindings).toBeGreaterThanOrEqual(0);
          expect(ok.totalIndexed).toBeGreaterThanOrEqual(0);
          break;
        }
        case "stale": {
          const stale: SyncStale = outcome;
          expect(stale.daysSinceSync).toBeGreaterThanOrEqual(0);
          break;
        }
      }
    }
  });

  test("backward compat: all SyncOutcome variants have success, newFindings, totalIndexed, lastSync", () => {
    const err = createNetworkError("fail");
    const ok = createSyncSuccess({
      newFindings: 5,
      totalIndexed: 100,
      lastSync: "2026-02-19T00:00:00.000Z",
    });
    const stale: SyncStale = {
      status: "stale",
      success: false,
      newFindings: 0,
      totalIndexed: 0,
      lastSync: "2026-01-01T00:00:00.000Z",
      daysSinceSync: 49,
    };

    // All variants expose the legacy SyncResult fields
    for (const outcome of [err, ok, stale] as SyncOutcome[]) {
      expect(typeof outcome.success).toBe("boolean");
      expect(typeof outcome.newFindings).toBe("number");
      expect(typeof outcome.totalIndexed).toBe("number");
      expect(typeof outcome.lastSync).toBe("string");
    }
  });
});
