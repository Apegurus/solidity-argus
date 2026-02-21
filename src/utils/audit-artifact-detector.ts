import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "../shared/logger"

const logger = createLogger()

export interface AuditArtifact {
  type: "audit-report" | "slither-output" | "deployment-artifact" | "security-tool-output"
  path: string
  name: string
}

/**
 * Detects audit artifacts in a project directory (shallow scan, top-level only)
 * @param projectDir Directory to scan for audit artifacts
 * @returns Array of detected audit artifacts
 */
export function detectAuditArtifacts(projectDir: string): AuditArtifact[] {
  const artifacts: AuditArtifact[] = []

  if (!existsSync(projectDir)) {
    return artifacts
  }

  try {
    const entries = readdirSync(projectDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(projectDir, entry.name)

      // Check directories
      if (entry.isDirectory()) {
        // Audit report directories
        if (["audit", "audits", "security"].includes(entry.name)) {
          artifacts.push({
            type: "audit-report",
            path: fullPath,
            name: entry.name,
          })
          continue
        }

        // Deployment artifact directories
        if (entry.name === ".openzeppelin") {
          artifacts.push({
            type: "deployment-artifact",
            path: fullPath,
            name: entry.name,
          })
          continue
        }

        // docs/audit* directories
        if (entry.name === "docs") {
          try {
            const docsEntries = readdirSync(fullPath, { withFileTypes: true })
            for (const docsEntry of docsEntries) {
              if (docsEntry.isDirectory() && docsEntry.name.startsWith("audit")) {
                artifacts.push({
                  type: "audit-report",
                  path: join(fullPath, docsEntry.name),
                  name: docsEntry.name,
                })
              }
            }
          } catch {
            logger.debug("Failed to read docs directory for audit artifacts")
          }
        }
        continue
      }

      // Check files
      if (entry.isFile()) {
        // Audit report files
        if (
          /^.*audit.*\.(md|pdf)$/i.test(entry.name) ||
          /^.*security-review.*\.(md|pdf)$/i.test(entry.name)
        ) {
          artifacts.push({
            type: "audit-report",
            path: fullPath,
            name: entry.name,
          })
          continue
        }

        // Slither output files
        if (
          entry.name === "slither.json" ||
          entry.name === "slither.sarif" ||
          /^slither-report.*/.test(entry.name)
        ) {
          artifacts.push({
            type: "slither-output",
            path: fullPath,
            name: entry.name,
          })
          continue
        }

        // Security tool output files
        if (/^mythril-report.*/.test(entry.name) || /^securify-report.*/.test(entry.name)) {
          artifacts.push({
            type: "security-tool-output",
            path: fullPath,
            name: entry.name,
          })
        }
      }
    }
  } catch {
    // Return empty array if directory cannot be read
    return []
  }

  return artifacts
}
