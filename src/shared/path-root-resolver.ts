import { existsSync } from "node:fs"
import { join } from "node:path"

export interface ArgusRootResolver {
  writeRoot(projectDir: string): string
  readRoots(projectDir: string): string[]
  resolveReadPath(projectDir: string, relativePath: string): string | null
}

class DefaultArgusRootResolver implements ArgusRootResolver {
  writeRoot(projectDir: string): string {
    return join(projectDir, ".argus")
  }

  readRoots(projectDir: string): string[] {
    return [this.writeRoot(projectDir), join(projectDir, ".opencode")]
  }

  resolveReadPath(projectDir: string, relativePath: string): string | null {
    for (const root of this.readRoots(projectDir)) {
      const candidatePath = join(root, relativePath)
      if (existsSync(candidatePath)) {
        return candidatePath
      }
    }
    return null
  }
}

export function createArgusRootResolver(): ArgusRootResolver {
  return new DefaultArgusRootResolver()
}

export const defaultRootResolver: ArgusRootResolver = createArgusRootResolver()
