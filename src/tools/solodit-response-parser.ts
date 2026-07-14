type Parsed<T> = { value: T; next: number }

const FINDING_KEYS = new Set(["title", "impact", "content", "protocol_name", "slug"])

function skipWhitespace(input: string, start: number): number {
  let index = start
  while (/\s/.test(input[index] ?? "")) index += 1
  return index
}

function readQuotedString(input: string, start: number): Parsed<string> | undefined {
  if (input[start] !== '"') return undefined
  let escaped = false
  for (let index = start + 1; index < input.length; index += 1) {
    const character = input[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === "\\") {
      escaped = true
      continue
    }
    if (character !== '"') continue
    try {
      const value: unknown = JSON.parse(input.slice(start, index + 1))
      return typeof value === "string" ? { value, next: index + 1 } : undefined
    } catch (error) {
      if (error instanceof SyntaxError) return undefined
      throw error
    }
  }
  return undefined
}

function readIdentifier(input: string, start: number): Parsed<string> | undefined {
  const first = input[start] ?? ""
  if (!/[A-Za-z_$]/.test(first)) return undefined
  let index = start + 1
  while (/[\w$]/.test(input[index] ?? "")) index += 1
  return { value: input.slice(start, index), next: index }
}

function readPropertyKey(input: string, start: number): Parsed<string> | undefined {
  return readQuotedString(input, start) ?? readIdentifier(input, start)
}

function arrayStartAfterFindingsKey(input: string, start: number): number | undefined {
  const key = readPropertyKey(input, start)
  if (!key || key.value !== "findings") return undefined
  const colon = skipWhitespace(input, key.next)
  if (input[colon] !== ":") return undefined
  const arrayStart = skipWhitespace(input, colon + 1)
  return input[arrayStart] === "[" ? arrayStart + 1 : undefined
}

function findFindingsArray(input: string): number | undefined {
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"') {
      const quoted = readQuotedString(input, index)
      if (!quoted) return undefined
      const arrayStart = arrayStartAfterFindingsKey(input, index)
      if (arrayStart !== undefined) return arrayStart
      index = quoted.next - 1
      continue
    }
    if (/[A-Za-z_$]/.test(character ?? "")) {
      const identifier = readIdentifier(input, index)
      if (!identifier) continue
      const arrayStart = arrayStartAfterFindingsKey(input, index)
      if (arrayStart !== undefined) return arrayStart
      index = identifier.next - 1
    }
  }
  return undefined
}

function skipValue(input: string, start: number): number | undefined {
  let braces = 0
  let brackets = 0
  let parentheses = 0
  for (let index = start; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"') {
      const quoted = readQuotedString(input, index)
      if (!quoted) return undefined
      index = quoted.next - 1
      continue
    }
    if (character === "{") braces += 1
    else if (character === "[") brackets += 1
    else if (character === "(") parentheses += 1
    else if (character === "}") {
      if (braces === 0 && brackets === 0 && parentheses === 0) return index
      braces -= 1
    } else if (character === "]") {
      if (braces === 0 && brackets === 0 && parentheses === 0) return index
      brackets -= 1
    } else if (character === ")") parentheses -= 1
    else if (character === "," && braces === 0 && brackets === 0 && parentheses === 0) {
      return index
    }
    if (braces < 0 || brackets < 0 || parentheses < 0) return undefined
  }
  return undefined
}

function readFinding(input: string, start: number): Parsed<Record<string, unknown>> | undefined {
  if (input[start] !== "{") return undefined
  const finding: Record<string, unknown> = {}
  let index = start + 1
  while (index < input.length) {
    index = skipWhitespace(input, index)
    if (input[index] === "}") return { value: finding, next: index + 1 }
    const key = readPropertyKey(input, index)
    if (!key) return undefined
    index = skipWhitespace(input, key.next)
    if (input[index] !== ":") return undefined
    index = skipWhitespace(input, index + 1)
    if (FINDING_KEYS.has(key.value)) {
      const stringValue = readQuotedString(input, index)
      if (stringValue) {
        finding[key.value] = stringValue.value
        index = stringValue.next
      } else {
        const next = skipValue(input, index)
        if (next === undefined) return undefined
        index = next
      }
    } else {
      const next = skipValue(input, index)
      if (next === undefined) return undefined
      index = next
    }
    index = skipWhitespace(input, index)
    if (input[index] === ",") {
      index += 1
      continue
    }
    if (input[index] === "}") return { value: finding, next: index + 1 }
    return undefined
  }
  return undefined
}

export function parseSoloditFindings(input: string): Record<string, unknown>[] | undefined {
  let index = findFindingsArray(input)
  if (index === undefined) return undefined
  const findings: Record<string, unknown>[] = []
  while (index < input.length) {
    index = skipWhitespace(input, index)
    if (input[index] === "]") return findings
    const finding = readFinding(input, index)
    if (!finding) return undefined
    findings.push(finding.value)
    index = skipWhitespace(input, finding.next)
    if (input[index] === ",") {
      index += 1
      continue
    }
    if (input[index] === "]") return findings
    return undefined
  }
  return undefined
}
