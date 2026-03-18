import { isAbsolute, normalize, relative } from "node:path"

export function normalizeFilePath(filePath: string, projectDir: string): string {
  if (!filePath) return ""
  const normalized = normalize(filePath)
  if (isAbsolute(normalized)) {
    const rel = relative(projectDir, normalized)
    return rel.startsWith("..") ? normalized : rel
  }
  return normalized.replace(/^\.\//, "")
}
