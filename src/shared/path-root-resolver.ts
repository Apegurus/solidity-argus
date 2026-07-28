import { existsSync } from "node:fs"
import { join } from "node:path"

export interface ArgusRootResolver {
  writeRoot(projectDir: string): string
  readRoots(projectDir: string): string[]
  resolveReadPath(projectDir: string, relativePath: string): string | null
}

export const defaultRootResolver: ArgusRootResolver = {
  writeRoot(projectDir: string): string {
    return join(projectDir, ".argus")
  },

  readRoots(projectDir: string): string[] {
    return [join(projectDir, ".argus"), join(projectDir, ".opencode")]
  },

  resolveReadPath(projectDir: string, relativePath: string): string | null {
    for (const root of defaultRootResolver.readRoots(projectDir)) {
      const candidatePath = join(root, relativePath)
      if (existsSync(candidatePath)) {
        return candidatePath
      }
    }
    return null
  },
}
