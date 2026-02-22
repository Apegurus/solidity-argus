export interface SoloditHealthStatus {
  reachable: boolean
  enabled: boolean
  port: number
  error?: string
}

const MCP_INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "argus-health-probe", version: "1.0.0" },
  },
  id: 1,
})

export async function checkSoloditHealth(
  port: number,
  enabled: boolean,
): Promise<SoloditHealthStatus> {
  if (!enabled) {
    return { reachable: false, enabled: false, port }
  }

  try {
    const response = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: MCP_INITIALIZE_BODY,
      signal: AbortSignal.timeout(2000),
    })
    // Any 2xx response means the MCP server is reachable (even if body contains JSON-RPC error)
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
