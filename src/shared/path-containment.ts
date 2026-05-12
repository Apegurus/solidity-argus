import { relative, resolve } from "node:path"

export function isContained(child: string, root: string): boolean {
  const resolvedChild = resolve(root, child)
  const resolvedRoot = resolve(root)
  const rel = relative(resolvedRoot, resolvedChild)
  return !rel.startsWith("..")
}

export function assertContained(child: string, root: string): string {
  const resolvedChild = resolve(root, child)
  if (!isContained(resolvedChild, root)) {
    throw new Error(`Path "${child}" resolves outside project root "${root}"`)
  }
  return resolvedChild
}

export function validateUrlScheme(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}
