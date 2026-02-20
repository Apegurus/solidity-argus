export interface SoloditHealthStatus {
  reachable: boolean
  enabled: boolean
  port: number
  error?: string
}

export async function checkSoloditHealth(
  port: number,
  enabled: boolean,
): Promise<SoloditHealthStatus> {
  if (!enabled) {
    return { reachable: false, enabled: false, port }
  }

  try {
    const response = await fetch(`http://localhost:${port}/mcp`, {
      signal: AbortSignal.timeout(2000),
    })
    return { reachable: response.ok, enabled: true, port }
  } catch (error) {
    return {
      reachable: false,
      enabled: true,
      port,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
