export function stripJsoncComments(jsonc: string): string {
  let inString = false
  let escaped = false
  let inLineComment = false
  let blockCommentDepth = 0
  const chars: string[] = []

  for (let i = 0; i < jsonc.length; i++) {
    const ch = jsonc.charAt(i)
    const next = jsonc.charAt(i + 1)

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false
        chars.push(ch)
      }
      continue
    }

    if (blockCommentDepth > 0) {
      if (ch === "/" && next === "*") {
        blockCommentDepth++
        i++
        continue
      }

      if (ch === "*" && next === "/") {
        blockCommentDepth--
        i++
        continue
      }

      if (ch === "\n" || ch === "\r") {
        chars.push(ch)
      }
      continue
    }

    if (escaped) {
      escaped = false
      chars.push(ch)
      continue
    }

    if (inString) {
      if (ch === "\\") {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      chars.push(ch)
      continue
    }

    if (ch === '"') {
      inString = true
      chars.push(ch)
      continue
    }

    if (ch === "/" && next === "/") {
      inLineComment = true
      i++
      continue
    }

    if (ch === "/" && next === "*") {
      blockCommentDepth = 1
      i++
      continue
    }

    chars.push(ch)
  }

  const result = chars.join("")
  const out: string[] = []
  let inString2 = false
  let escaped2 = false

  for (let i = 0; i < result.length; i++) {
    const ch = result.charAt(i)

    if (escaped2) {
      escaped2 = false
      out.push(ch)
      continue
    }

    if (inString2) {
      if (ch === "\\") {
        escaped2 = true
      } else if (ch === '"') {
        inString2 = false
      }
      out.push(ch)
      continue
    }

    if (ch === '"') {
      inString2 = true
      out.push(ch)
      continue
    }

    if (ch === ",") {
      let j = i + 1
      while (j < result.length) {
        const lookahead = result.charAt(j)
        if (lookahead === " " || lookahead === "\t" || lookahead === "\n" || lookahead === "\r") {
          j++
          continue
        }

        if (lookahead === "}" || lookahead === "]") {
          break
        }

        out.push(ch)
        break
      }

      if (j >= result.length) {
        out.push(ch)
      }

      continue
    }

    out.push(ch)
  }

  return out.join("")
}
