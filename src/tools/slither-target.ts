import { existsSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { assertContained, isContained, PathSafetyError } from "../shared/path-safety"
import { findFoundryProjectDir } from "../shared/project-utils"
import type { Finding } from "../state/types"

export {
  type FoundryCompilerConfigValidation,
  validateFoundryCompilerConfig,
  validateFoundrySourceClosure,
} from "./slither-foundry-safety"

export type SlitherTargetValidation =
  | { readonly ok: true; readonly target: string }
  | {
      readonly ok: false
      readonly code: "SLITHER_TARGET_NOT_FOUND" | "SLITHER_TARGET_OUTSIDE_PROJECT"
      readonly message: string
    }

export function validateSlitherTarget(
  requestedTarget: string,
  projectRoot: string,
): SlitherTargetValidation {
  const absoluteTarget = isAbsolute(requestedTarget)
    ? resolve(requestedTarget)
    : resolve(projectRoot, requestedTarget)
  if (!existsSync(absoluteTarget)) {
    return {
      ok: false,
      code: "SLITHER_TARGET_NOT_FOUND",
      message: `Slither target does not exist: ${relative(projectRoot, absoluteTarget)}`,
    }
  }
  try {
    return { ok: true, target: assertContained(absoluteTarget, projectRoot) }
  } catch (error) {
    if (error instanceof PathSafetyError) {
      return {
        ok: false,
        code: "SLITHER_TARGET_OUTSIDE_PROJECT",
        message: "Slither target resolves outside the active project",
      }
    }
    throw error
  }
}

export function resolveSlitherInvocation(
  target: string,
  projectDir: string,
): { readonly commandTarget: string; readonly cwd: string; readonly reportTarget: string } {
  const foundryRoot = findFoundryProjectDir(target, projectDir)
  if (!existsSync(join(foundryRoot, "foundry.toml"))) {
    return { commandTarget: target, cwd: projectDir, reportTarget: target }
  }
  return {
    commandTarget: foundryRoot,
    cwd: foundryRoot,
    reportTarget: target,
  }
}

export function filterSlitherFindings(
  findings: Finding[],
  requestedTarget: string,
  executionCwd: string,
  projectDir: string,
): Finding[] {
  const normalized = findings.flatMap((finding) => {
    const absoluteFinding = isAbsolute(finding.file)
      ? resolve(finding.file)
      : resolve(executionCwd, finding.file)
    return isContained(absoluteFinding, projectDir)
      ? [{ ...finding, file: relative(projectDir, absoluteFinding) }]
      : []
  })
  const absoluteTarget = isAbsolute(requestedTarget)
    ? resolve(requestedTarget)
    : resolve(projectDir, requestedTarget)
  return normalized.filter((finding) => {
    const absoluteFinding = resolve(projectDir, finding.file)
    return requestedTarget.endsWith(".sol")
      ? absoluteFinding === absoluteTarget
      : isContained(absoluteFinding, absoluteTarget)
  })
}
