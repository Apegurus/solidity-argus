import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "../shared/logger"
import type { ResolvedSkill } from "../skills/argus-skill-resolver"
import { parseFrontmatter, SkillFrontmatterSchema } from "../skills/skill-schema"
import type { PatternDefinition } from "./pattern-schema"

const logger = createLogger()
const MAX_SKILL_REGEX_LENGTH = 1_000

function listSkillMarkdownFiles(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) {
    logger.warn(`Skills directory does not exist: ${skillsDir}`)
    return []
  }

  const files: string[] = []
  const stack = [skillsDir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (entry.isFile() && entry.name === "SKILL.md") {
        files.push(fullPath)
      }
    }
  }

  return files
}

export interface PatternLoaderResult {
  patterns: PatternDefinition[]
  errors: string[]
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function findGroupEnd(regex: string, startIndex: number): number {
  let depth = 0
  let inCharacterClass = false

  for (let i = startIndex; i < regex.length; i += 1) {
    const char = regex[i]
    if (!char || isEscaped(regex, i)) continue

    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue

    if (char === "(") depth += 1
    if (char === ")") {
      depth -= 1
      if (depth === 0) return i
    }
  }

  return -1
}

function hasAnyQuantifier(regex: string): boolean {
  let inCharacterClass = false

  for (let i = 0; i < regex.length; i += 1) {
    const char = regex[i]
    if (!char || isEscaped(regex, i)) continue

    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue

    if (char === "*" || char === "+" || char === "?") return true
    if (char === "{" && /^\{\d+,?\d*\}/.test(regex.slice(i))) return true
  }

  return false
}

function hasUnboundedQuantifierAt(regex: string, index: number): boolean {
  const char = regex[index]
  if (char === "*" || char === "+") return true
  if (char !== "{") return false

  return /^\{\d+,\}/.test(regex.slice(index))
}

function hasRepeatedQuantifierAt(regex: string, index: number): boolean {
  if (hasUnboundedQuantifierAt(regex, index)) return true

  const exact = regex.slice(index).match(/^\{(\d+)\}/)
  if (exact) return Number.parseInt(exact[1] ?? "0", 10) > 1

  const bounded = regex.slice(index).match(/^\{\d+,(\d+)\}/)
  return bounded ? Number.parseInt(bounded[1] ?? "0", 10) > 1 : false
}

function hasAmbiguousRepeatedQuantifierAt(regex: string, index: number): boolean {
  if (hasUnboundedQuantifierAt(regex, index)) return true

  const match = regex.slice(index).match(/^\{(\d+)(?:,(\d+))?\}/)
  if (!match || match[2] === undefined) return false

  const min = Number.parseInt(match[1] ?? "", 10)
  const max = Number.parseInt(match[2], 10)
  return max > min && max > 1
}

function hasUnsafeRepeatedGroup(regex: string): boolean {
  let inCharacterClass = false

  for (let i = 0; i < regex.length; i += 1) {
    const char = regex[i]
    if (!char || isEscaped(regex, i)) continue

    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass || char !== "(") continue

    const end = findGroupEnd(regex, i)
    if (end === -1) return false

    const groupBody = readGroupBody(regex, i, end + 1) ?? regex.slice(i + 1, end)
    if (hasUnsafeRepeatedGroup(groupBody)) return true

    if (
      hasRepeatedQuantifierAt(regex, end + 1) &&
      (groupBody.includes("|") || groupBody.includes("(") || hasAnyQuantifier(groupBody))
    ) {
      return true
    }

    i = end
  }

  return false
}

function hasLookaround(regex: string): boolean {
  let inCharacterClass = false

  for (let i = 0; i < regex.length; i += 1) {
    const char = regex[i]
    if (!char || isEscaped(regex, i)) continue

    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass || char !== "(") continue

    const next = regex.slice(i, i + 4)
    if (
      next.startsWith("(?=") ||
      next.startsWith("(?!") ||
      next.startsWith("(?<=") ||
      next.startsWith("(?<!")
    ) {
      return true
    }
  }

  return false
}

function hasUnsupportedGroupSyntax(regex: string): boolean {
  let inCharacterClass = false

  for (let i = 0; i < regex.length; i += 1) {
    const char = regex[i]
    if (!char || isEscaped(regex, i)) continue

    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass || char !== "(" || regex[i + 1] !== "?") continue

    if (regex.slice(i, i + 3) === "(?:") continue
    if (regex.slice(i, i + 3) === "(?<") {
      const nameStart = i + 3
      const nameEnd = regex.indexOf(">", nameStart)
      const discriminator = regex[nameStart]
      if (discriminator === "=" || discriminator === "!" || nameEnd === -1) return true

      i = nameEnd
      continue
    }

    return true
  }

  return false
}

function hasBackreference(regex: string): boolean {
  let inCharacterClass = false

  for (let i = 0; i < regex.length; i += 1) {
    const char = regex[i]
    if (!char) continue

    if (char === "[" && !isEscaped(regex, i)) {
      inCharacterClass = true
      continue
    }
    if (char === "]" && !isEscaped(regex, i)) {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue

    if (/^[1-9]$/.test(char) && isEscaped(regex, i)) return true
    if (char === "k" && regex[i + 1] === "<" && isEscaped(regex, i)) return true
  }

  return false
}

function hasLegacyControlEscape(regex: string): boolean {
  for (let i = 0; i < regex.length; i += 1) {
    if (regex[i] === "c" && isEscaped(regex, i) && /^[A-Za-z]$/.test(regex[i + 1] ?? "")) {
      return true
    }
  }

  return false
}

interface RegexAtom {
  end: number
  value: string
}

interface RegexScanAtom {
  ambiguous: boolean
  end: number
  nullable: boolean
  value: string
}

type AtomCharacterMatcher = (char: string) => boolean

interface CharacterClassUnit {
  end: number
  literal: string | null
  matches: AtomCharacterMatcher
}

const ATOM_OVERLAP_PROBES = [
  ...Array.from({ length: 128 }, (_, code) => String.fromCharCode(code)),
  "\u00a0",
  "\u2028",
  "\u2029",
]

function readEscapedAtom(value: string, index: number): RegexAtom | null {
  if (value[index] !== "\\") return null

  const next = value[index + 1]
  if (!next) return null

  if (next === "x" && /^[0-9A-Fa-f]{2}$/.test(value.slice(index + 2, index + 4))) {
    return { end: index + 4, value: value.slice(index, index + 4) }
  }

  if (next === "u") {
    const braced = value.slice(index + 2).match(/^\{[0-9A-Fa-f]{1,6}\}/)
    if (braced)
      return {
        end: index + 2 + braced[0].length,
        value: value.slice(index, index + 2 + braced[0].length),
      }

    if (/^[0-9A-Fa-f]{4}$/.test(value.slice(index + 2, index + 6))) {
      return { end: index + 6, value: value.slice(index, index + 6) }
    }
  }

  if (/^[0-7]$/.test(next)) {
    const octal = value.slice(index + 1).match(/^[0-7]{1,3}/)
    if (octal)
      return {
        end: index + 1 + octal[0].length,
        value: value.slice(index, index + 1 + octal[0].length),
      }
  }

  return { end: index + 2, value: value.slice(index, index + 2) }
}

function isWordBoundaryAssertion(atom: string): boolean {
  return atom === "\\b" || atom === "\\B"
}

function readRegexAtom(regex: string, index: number): RegexAtom | null {
  const char = regex[index]
  if (!char || "^$|)".includes(char)) return null

  if (char === "\\") {
    return readEscapedAtom(regex, index)
  }

  if (char === "[") {
    for (let i = index + 1; i < regex.length; i += 1) {
      if (regex[i] === "]" && !isEscaped(regex, i)) {
        return { end: i + 1, value: regex.slice(index, i + 1) }
      }
    }
    return null
  }

  if (char === "(") {
    const end = findGroupEnd(regex, index)
    return end === -1 ? null : { end: end + 1, value: regex.slice(index, end + 1) }
  }

  return { end: index + 1, value: char }
}

function readQuantifierEnd(regex: string, index: number): number | null {
  const char = regex[index]
  if (char === "*" || char === "+") return regex[index + 1] === "?" ? index + 2 : index + 1

  if (char !== "{") return null

  const match = regex.slice(index).match(/^\{\d+,?\d*\}\??/)
  if (!match) return null

  return index + match[0].length
}

function readExactOneQuantifierEnd(regex: string, index: number): number | null {
  const match = regex.slice(index).match(/^\{(\d+)(?:,(\d+))?\}\??/)
  if (!match) return null

  const min = Number.parseInt(match[1] ?? "", 10)
  const max = match[2] === undefined ? min : Number.parseInt(match[2], 10)

  return min === 1 && max === 1 ? index + match[0].length : null
}

function readOptionalQuantifierEnd(regex: string, index: number): number | null {
  if (regex[index] === "?") return regex[index + 1] === "?" ? index + 2 : index + 1

  const match = regex.slice(index).match(/^\{(\d+),(\d+)\}\??/)
  if (!match) return null

  const min = Number.parseInt(match[1] ?? "", 10)
  const max = Number.parseInt(match[2] ?? "", 10)

  return min <= 1 && max === 1 ? index + match[0].length : null
}

function readNullableQuantifierEnd(regex: string, index: number): number | null {
  if (regex[index] === "*") return regex[index + 1] === "?" ? index + 2 : index + 1

  const match = regex.slice(index).match(/^\{(\d+),?\d*\}\??/)
  if (!match) return readOptionalQuantifierEnd(regex, index)

  return Number.parseInt(match[1] ?? "", 10) === 0 ? index + match[0].length : null
}

function readGroupBody(regex: string, index: number, end: number): string | null {
  if (regex[index] !== "(") return null
  if (regex.slice(index, index + 3) === "(?:") return regex.slice(index + 3, end - 1)
  if (regex.slice(index, index + 3) === "(?<") {
    const nameEnd = regex.indexOf(">", index + 3)
    return nameEnd === -1 ? null : regex.slice(nameEnd + 1, end - 1)
  }
  if (regex.slice(index, index + 2) === "(?") return null

  return regex.slice(index + 1, end - 1)
}

function topLevelAlternatives(body: string): string[] | null {
  const alternatives: string[] = []
  let depth = 0
  let inCharacterClass = false
  let start = 0

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]
    if (!char || isEscaped(body, i)) continue

    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue

    if (char === "(") {
      depth += 1
      continue
    }
    if (char === ")") {
      depth -= 1
      continue
    }

    if (char === "|" && depth === 0) {
      alternatives.push(body.slice(start, i))
      start = i + 1
    }
  }

  if (alternatives.length === 0) return null
  alternatives.push(body.slice(start))
  return alternatives
}

function readTransparentGroupAtom(regex: string, index: number, end: number): RegexAtom | null {
  const groupBody = readGroupBody(regex, index, end)
  if (groupBody === null) return null

  const wrapped = readQuantifiedAtom(groupBody, 0)
  if (wrapped?.end !== groupBody.length) return null

  return wrapped
}

function literalFromEscapedAtom(atom: string): string | null {
  if (atom[0] !== "\\") return null

  if (atom.startsWith("\\x") && atom.length === 4) {
    return String.fromCharCode(Number.parseInt(atom.slice(2), 16))
  }

  if (atom.startsWith("\\u{") && atom.endsWith("}")) {
    const codePoint = Number.parseInt(atom.slice(3, -1), 16)
    return Number.isNaN(codePoint) || codePoint > 0x10ffff ? null : String.fromCodePoint(codePoint)
  }

  if (atom.startsWith("\\u") && atom.length === 6) {
    return String.fromCharCode(Number.parseInt(atom.slice(2), 16))
  }

  if (/^\\[0-7]{1,3}$/.test(atom)) {
    return String.fromCharCode(Number.parseInt(atom.slice(1), 8))
  }

  if (atom.length !== 2) return null

  switch (atom[1]) {
    case "n":
      return "\n"
    case "r":
      return "\r"
    case "t":
      return "\t"
    case "f":
      return "\f"
    case "v":
      return "\v"
    case "0":
      return "\0"
    case "b":
      return "\b"
    case "d":
    case "D":
    case "s":
    case "S":
    case "w":
    case "W":
      return null
    default:
      return atom[1] ?? null
  }
}

function matcherForEscapedCharacterClass(atom: string): AtomCharacterMatcher | null {
  switch (atom) {
    case "\\d":
      return (char) => /^[0-9]$/.test(char)
    case "\\D":
      return (char) => !/^[0-9]$/.test(char)
    case "\\s":
      return (char) => /^\s$/.test(char)
    case "\\S":
      return (char) => !/^\s$/.test(char)
    case "\\w":
      return (char) => /^[A-Za-z0-9_]$/.test(char)
    case "\\W":
      return (char) => !/^[A-Za-z0-9_]$/.test(char)
    default:
      return null
  }
}

function readCharacterClassUnit(body: string, index: number): CharacterClassUnit | null {
  const char = body[index]
  if (!char) return null

  if (char === "\\") {
    const atom = readEscapedAtom(body, index)
    if (!atom) return null

    const classMatcher = matcherForEscapedCharacterClass(atom.value)
    if (classMatcher) return { end: atom.end, literal: null, matches: classMatcher }

    const literal = literalFromEscapedAtom(atom.value)
    return literal === null
      ? null
      : { end: atom.end, literal, matches: (candidate) => candidate === literal }
  }

  return { end: index + 1, literal: char, matches: (candidate) => candidate === char }
}

function matcherForCharacterClass(atom: string): AtomCharacterMatcher | null {
  if (!atom.startsWith("[") || !atom.endsWith("]")) return null

  const body = atom.slice(1, -1)
  const negated = body.startsWith("^")
  const units: AtomCharacterMatcher[] = []

  for (let i = negated ? 1 : 0; i < body.length; ) {
    const unit = readCharacterClassUnit(body, i)
    if (!unit) return null

    const nextIsRange = body[unit.end] === "-" && unit.end + 1 < body.length
    if (nextIsRange) {
      const rangeEnd = readCharacterClassUnit(body, unit.end + 1)
      if (unit.literal !== null && rangeEnd && rangeEnd.literal !== null) {
        const startCode = unit.literal.codePointAt(0)
        const endCode = rangeEnd.literal.codePointAt(0)
        if (startCode === undefined || endCode === undefined) return null

        units.push((candidate) => {
          const code = candidate.codePointAt(0)
          return code !== undefined && code >= startCode && code <= endCode
        })
        i = rangeEnd.end
        continue
      }
    }

    units.push(unit.matches)
    i = unit.end
  }

  return (candidate) => {
    const included = units.some((matches) => matches(candidate))
    return negated ? !included : included
  }
}

function matcherForAtom(atom: string, depth = 0): AtomCharacterMatcher | null {
  if (depth > 8) return null

  if (atom === ".") {
    return (char) => char !== "\n" && char !== "\r" && char !== "\u2028" && char !== "\u2029"
  }

  if (isWordBoundaryAssertion(atom)) return null

  const escapedClass = matcherForEscapedCharacterClass(atom)
  if (escapedClass) return escapedClass

  const escapedLiteral = literalFromEscapedAtom(atom)
  if (escapedLiteral !== null) return (char) => char === escapedLiteral

  const characterClass = matcherForCharacterClass(atom)
  if (characterClass) return characterClass

  if (atom.startsWith("(")) {
    const body = readGroupBody(atom, 0, atom.length)
    if (body !== null) {
      const alternatives = topLevelAlternatives(body)
      if (alternatives) {
        const matchers = alternatives.map((alternative) => {
          const alternativeAtom = readRegexAtom(alternative, 0)
          return alternativeAtom?.end === alternative.length
            ? matcherForAtom(alternativeAtom.value, depth + 1)
            : null
        })
        if (matchers.every((matcher) => matcher !== null)) {
          return (char) => matchers.some((matcher) => matcher?.(char) ?? false)
        }
      }

      const bodyAtom = readRegexAtom(body, 0)
      if (bodyAtom?.end === body.length) return matcherForAtom(bodyAtom.value, depth + 1)
    }
    return null
  }

  return atom.length === 1 ? (char) => char === atom : null
}

function literalProbesForAtom(atom: string, depth = 0): string[] {
  if (depth > 8) return []

  if (isWordBoundaryAssertion(atom)) return []

  const escapedLiteral = literalFromEscapedAtom(atom)
  if (escapedLiteral !== null) return [escapedLiteral]

  if (atom.startsWith("[") && atom.endsWith("]")) {
    const body = atom.slice(1, -1)
    const probes: string[] = []

    for (let i = body.startsWith("^") ? 1 : 0; i < body.length; ) {
      const unit = readCharacterClassUnit(body, i)
      if (!unit) return probes
      if (unit.literal !== null) probes.push(unit.literal)

      const nextIsRange = body[unit.end] === "-" && unit.end + 1 < body.length
      if (nextIsRange) {
        const rangeEnd = readCharacterClassUnit(body, unit.end + 1)
        if (rangeEnd && rangeEnd.literal !== null) {
          probes.push(rangeEnd.literal)
          i = rangeEnd.end
          continue
        }
      }

      i = unit.end
    }

    return probes
  }

  if (atom.startsWith("(")) {
    const body = readGroupBody(atom, 0, atom.length)
    if (body !== null) {
      const alternatives = topLevelAlternatives(body)
      if (alternatives) {
        return alternatives.flatMap((alternative) => {
          const alternativeAtom = readRegexAtom(alternative, 0)
          return alternativeAtom?.end === alternative.length
            ? literalProbesForAtom(alternativeAtom.value, depth + 1)
            : []
        })
      }

      const bodyAtom = readRegexAtom(body, 0)
      if (bodyAtom?.end === body.length) return literalProbesForAtom(bodyAtom.value, depth + 1)
    }
    return []
  }

  return atom.length === 1 ? [atom] : []
}

function quantifiedAtomsOverlap(left: string, right: string): boolean {
  if (left === right) return true

  const leftMatcher = matcherForAtom(left)
  const rightMatcher = matcherForAtom(right)
  if (!leftMatcher || !rightMatcher) return false

  const probes = new Set([
    ...ATOM_OVERLAP_PROBES,
    ...literalProbesForAtom(left),
    ...literalProbesForAtom(right),
  ])
  return [...probes].some((char) => leftMatcher(char) && rightMatcher(char))
}

function inlineTransparentGroups(regex: string): string {
  let result = ""

  for (let i = 0; i < regex.length; ) {
    const atom = readRegexAtom(regex, i)
    if (!atom) {
      result += regex[i] ?? ""
      i += 1
      continue
    }

    const groupBody = readGroupBody(regex, i, atom.end)
    if (groupBody !== null) {
      const quantifierEnd = readQuantifierEnd(regex, atom.end)
      const exactOneEnd = readExactOneQuantifierEnd(regex, atom.end)
      const optionalEnd = readOptionalQuantifierEnd(regex, atom.end)
      const transparentEnd =
        quantifierEnd === null
          ? (optionalEnd ?? atom.end)
          : exactOneEnd === quantifierEnd || optionalEnd === quantifierEnd
            ? quantifierEnd
            : null

      if (transparentEnd !== null && !topLevelAlternatives(groupBody)) {
        result += inlineTransparentGroups(groupBody)
        if (
          optionalEnd === transparentEnd &&
          exactOneEnd !== transparentEnd &&
          transparentEnd !== atom.end
        ) {
          result += regex.slice(atom.end, transparentEnd)
        }
        i = transparentEnd
        continue
      }
    }

    const end =
      readQuantifierEnd(regex, atom.end) ?? readOptionalQuantifierEnd(regex, atom.end) ?? atom.end
    result += regex.slice(i, end)
    i = end
  }

  return result
}

function readQuantifiedAtom(regex: string, index: number): RegexAtom | null {
  const atom = readRegexAtom(regex, index)
  if (!atom) return null

  const quantifierEnd = readQuantifierEnd(regex, atom.end)
  if (quantifierEnd) {
    const exactOneQuantifierEnd = readExactOneQuantifierEnd(regex, atom.end)
    if (exactOneQuantifierEnd === quantifierEnd) {
      const wrapped = readTransparentGroupAtom(regex, index, atom.end)
      if (wrapped) return { end: quantifierEnd, value: wrapped.value }
    }

    return { end: quantifierEnd, value: atom.value }
  }

  const wrapped = readTransparentGroupAtom(regex, index, atom.end)
  if (!wrapped) return null

  return { end: atom.end, value: wrapped.value }
}

function readRegexScanAtom(regex: string, index: number): RegexScanAtom | null {
  const atom = readRegexAtom(regex, index)
  if (!atom) return null

  if (isWordBoundaryAssertion(atom.value)) {
    return {
      ambiguous: false,
      end: atom.end,
      nullable: true,
      value: atom.value,
    }
  }

  const quantifierEnd = readQuantifierEnd(regex, atom.end)
  const nullableEnd = readNullableQuantifierEnd(regex, atom.end)
  const end = quantifierEnd ?? nullableEnd ?? atom.end

  return {
    ambiguous: quantifierEnd !== null && hasAmbiguousRepeatedQuantifierAt(regex, atom.end),
    end,
    nullable: nullableEnd === end,
    value: atom.value,
  }
}

function separatorKeepsQuantifiersAmbiguous(
  left: string,
  right: string,
  separators: RegexScanAtom[],
): boolean {
  return separators.every(
    (separator) =>
      separator.nullable ||
      (quantifiedAtomsOverlap(left, separator.value) &&
        quantifiedAtomsOverlap(right, separator.value)),
  )
}

function hasAdjacentAmbiguousQuantifiers(regex: string): boolean {
  let previousAmbiguousAtom: string | null = null
  let separators: RegexScanAtom[] = []

  for (let i = 0; i < regex.length; ) {
    const atom = readRegexAtom(regex, i)
    const groupBody = atom ? readGroupBody(regex, i, atom.end) : null
    if (groupBody !== null && hasAdjacentAmbiguousQuantifiers(groupBody)) {
      return true
    }

    const scanned = readRegexScanAtom(regex, i)
    if (!scanned) {
      previousAmbiguousAtom = null
      separators = []
      i = atom?.end ?? i + 1
      continue
    }

    if (
      scanned.ambiguous &&
      previousAmbiguousAtom !== null &&
      quantifiedAtomsOverlap(previousAmbiguousAtom, scanned.value) &&
      separatorKeepsQuantifiersAmbiguous(previousAmbiguousAtom, scanned.value, separators)
    ) {
      return true
    }

    if (scanned.ambiguous) {
      previousAmbiguousAtom = scanned.value
      separators = []
    } else if (previousAmbiguousAtom !== null) {
      separators.push(scanned)
    }

    i = scanned.end
  }

  return false
}

function regexSafetyError(regex: string): string | null {
  if (regex.length > MAX_SKILL_REGEX_LENGTH) {
    return `regex exceeds ${MAX_SKILL_REGEX_LENGTH} characters`
  }

  try {
    new RegExp(regex)
  } catch (error) {
    return `regex does not compile: ${error instanceof Error ? error.message : String(error)}`
  }

  if (hasBackreference(regex)) {
    return "backreferences are not allowed in skill detection rules"
  }

  if (hasLegacyControlEscape(regex)) {
    return "legacy control escapes are not allowed in skill detection rules"
  }

  if (hasLookaround(regex)) {
    return "lookaround assertions are not allowed in skill detection rules"
  }

  if (hasUnsupportedGroupSyntax(regex)) {
    return "unsupported group syntax is not allowed in skill detection rules"
  }

  if (hasUnsafeRepeatedGroup(regex)) {
    return "nested or ambiguous repeated groups are not allowed in skill detection rules"
  }

  if (hasAdjacentAmbiguousQuantifiers(inlineTransparentGroups(regex))) {
    return "adjacent ambiguous quantifiers are not allowed in skill detection rules"
  }

  return null
}

function appendSkillDetectionRules(
  extracted: PatternDefinition[],
  errors: string[],
  skillName: string,
  category: PatternDefinition["category"] | undefined,
  rules: ResolvedSkill["detection_rules"],
): void {
  if (!category) return
  if (!rules || rules.length === 0) return

  for (const [index, rule] of rules.entries()) {
    const name = `${skillName}-rule-${index + 1}`
    const safetyError = regexSafetyError(rule.regex)
    if (safetyError) {
      const msg = `Skipped unsafe detection rule ${name}: ${safetyError}`
      logger.warn(msg)
      errors.push(msg)
      continue
    }

    const unsafeExclude = rule.exclude_if?.find((exclude) => regexSafetyError(exclude))
    if (unsafeExclude) {
      const msg = `Skipped unsafe detection rule ${name}: exclude_if ${regexSafetyError(
        unsafeExclude,
      )}`
      logger.warn(msg)
      errors.push(msg)
      continue
    }

    extracted.push({
      name,
      category,
      severity: rule.severity,
      confidence: rule.confidence ?? "Medium",
      version: "1.0",
      regex: rule.regex,
      description: rule.description ?? `Detection rule from ${skillName} SKILL.md`,
      ...(rule.swc ? { swc: rule.swc } : {}),
      ...(rule.exclude_if ? { exclude_if: rule.exclude_if } : {}),
    })
  }
}

export function extractDetectionRulesFromSkills(skillsDir: string): PatternLoaderResult {
  const skillFiles = listSkillMarkdownFiles(skillsDir)
  const extracted: PatternDefinition[] = []
  const errors: string[] = []

  for (const filePath of skillFiles) {
    try {
      const content = readFileSync(filePath, "utf-8")
      const frontmatter = parseFrontmatter(content)
      if (!frontmatter) continue

      const parsed = SkillFrontmatterSchema.safeParse(frontmatter)
      if (!parsed.success) {
        const reason = parsed.error.issues.map((i) => i.message).join("; ")
        const msg = `Failed to parse ${filePath}: ${reason}`
        logger.warn(msg)
        errors.push(msg)
        continue
      }

      const skillName = parsed.data.name
      const category = parsed.data.pattern_category
      if (!category) continue

      appendSkillDetectionRules(extracted, errors, skillName, category, parsed.data.detection_rules)
    } catch (err) {
      const msg = `Failed to parse ${filePath}: ${err instanceof Error ? err.message : "parse error"}`
      logger.warn(msg)
      errors.push(msg)
    }
  }

  return { patterns: extracted, errors }
}

export function extractDetectionRulesFromResolvedSkills(
  skills: Iterable<ResolvedSkill>,
): PatternLoaderResult {
  const extracted: PatternDefinition[] = []
  const errors: string[] = []

  for (const skill of skills) {
    appendSkillDetectionRules(
      extracted,
      errors,
      skill.name,
      skill.pattern_category,
      skill.detection_rules,
    )
  }

  return { patterns: extracted, errors }
}
