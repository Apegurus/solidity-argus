import { isRecord } from "../../shared/type-guards"
import { parseFrontmatter } from "../skill-schema"
import { STOPWORDS } from "./stopwords"

export interface SkillDoc {
  name: string
  description: string
  category: string | undefined
  detectionRules: string[]
  bodyText: string
  bodyTokens: string[]
  nameDescTokens: string[]
  ruleTokens: string[]
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "")
}

function stripCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, " ")
}

function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, " ")
}

function normalizeWhitespace(content: string): string {
  return content.toLowerCase().replace(/\s+/g, " ").trim()
}

function tokenize(text: string): string[] {
  if (!text) return []

  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOPWORDS.has(token))
}

function extractDetectionRules(frontmatter: Record<string, unknown>): string[] {
  const rawRules = frontmatter.detection_rules
  if (!Array.isArray(rawRules)) return []

  const rules: string[] = []
  for (const rule of rawRules) {
    if (!isRecord(rule)) continue
    if (typeof rule.regex !== "string") continue
    rules.push(rule.regex)
  }

  return rules
}

function normalizeRuleToken(token: string): string {
  return token.replace(/^[_.]+|[_.]+$/g, "").toLowerCase()
}

function extractRuleTokens(rules: string[]): string[] {
  const tokens: string[] = []

  for (const rule of rules) {
    const parts = rule.split(/[^a-zA-Z0-9_.]+/g)
    for (const part of parts) {
      const normalized = normalizeRuleToken(part)
      if (!normalized) continue
      if (normalized.length < 3) continue
      tokens.push(normalized)
    }
  }

  return tokens
}

export function normalizeSkill(content: string): SkillDoc | null {
  if (!content.trim()) return null

  const frontmatter = parseFrontmatter(content)
  if (!frontmatter) return null

  const rawName = frontmatter.name
  if (typeof rawName !== "string" || !rawName.trim()) return null

  const name = rawName.trim()
  const description = typeof frontmatter.description === "string" ? frontmatter.description : ""
  const category = typeof frontmatter.category === "string" ? frontmatter.category : undefined

  const detectionRules = extractDetectionRules(frontmatter)
  const bodyWithoutFrontmatter = stripFrontmatter(content)
  const withoutComments = stripHtmlComments(bodyWithoutFrontmatter)
  const withoutCode = stripCodeBlocks(withoutComments)
  const bodyText = normalizeWhitespace(withoutCode)

  return {
    name,
    description,
    category,
    detectionRules,
    bodyText,
    bodyTokens: tokenize(bodyText),
    nameDescTokens: tokenize(`${name} ${description}`),
    ruleTokens: extractRuleTokens(detectionRules),
  }
}
