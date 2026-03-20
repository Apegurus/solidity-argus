export type SyncError = {
  status: "error"
  success: false
  reason: "network" | "api" | "parse" | "lock"
  message: string
  error: string
  httpStatus?: number
  newFindings: 0
  totalIndexed: 0
  lastSync: string
  attempts?: number
}

export type SyncSuccess = {
  status: "success"
  success: true
  newFindings: number
  totalIndexed: number
  lastSync: string
  error?: undefined
  attempts?: number
}

export type SyncStale = {
  status: "stale"
  success: false
  newFindings: 0
  totalIndexed: 0
  lastSync: string
  error?: undefined
  daysSinceSync: number
  attempts?: number
}

export type SyncOutcome = SyncSuccess | SyncError | SyncStale

export function createNetworkError(message: string): SyncError {
  return {
    status: "error",
    success: false,
    reason: "network",
    message,
    error: message,
    newFindings: 0,
    totalIndexed: 0,
    lastSync: new Date().toISOString(),
  }
}

export function createApiError(httpStatus: number, message: string): SyncError {
  return {
    status: "error",
    success: false,
    reason: "api",
    message,
    error: message,
    httpStatus,
    newFindings: 0,
    totalIndexed: 0,
    lastSync: new Date().toISOString(),
  }
}

export function createParseError(message: string): SyncError {
  return {
    status: "error",
    success: false,
    reason: "parse",
    message,
    error: message,
    newFindings: 0,
    totalIndexed: 0,
    lastSync: new Date().toISOString(),
  }
}

export function createLockError(message: string): SyncError {
  return {
    status: "error",
    success: false,
    reason: "lock",
    message,
    error: message,
    newFindings: 0,
    totalIndexed: 0,
    lastSync: new Date().toISOString(),
  }
}

export function createSyncSuccess(
  data: Omit<SyncSuccess, "status" | "success" | "error"> & { attempts?: number },
): SyncSuccess {
  return {
    status: "success",
    success: true,
    ...data,
  }
}

const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504])

export function isRetryableError(outcome: SyncOutcome): boolean {
  if (outcome.status !== "error") return false
  if (outcome.reason === "network") return true
  if (outcome.reason === "api" && outcome.httpStatus && RETRYABLE_HTTP_STATUSES.has(outcome.httpStatus)) return true
  return false
}
