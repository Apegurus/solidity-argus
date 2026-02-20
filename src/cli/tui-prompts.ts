import { cliOutput } from "./cli-output"

const NON_INTERACTIVE =
  !process.stdin.isTTY || process.env.CI === "true" || process.env.ARGUS_NON_INTERACTIVE === "true"

export async function confirm(message: string, defaultValue = true): Promise<boolean> {
  if (NON_INTERACTIVE) return defaultValue

  const hint = defaultValue ? "[Y/n]" : "[y/N]"
  process.stdout.write(`${message} ${hint} `)

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners("data")
      resolve(defaultValue)
    }, 30_000)

    process.stdin.once("data", (data) => {
      clearTimeout(timeout)
      const input = data.toString().trim().toLowerCase()
      if (input === "") resolve(defaultValue)
      else resolve(input === "y" || input === "yes")
    })
  })
}

export async function select(
  message: string,
  options: string[],
  defaultIndex = 0,
): Promise<string> {
  if (NON_INTERACTIVE) return options[defaultIndex] ?? options[0] ?? ""

  cliOutput.log(message)
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIndex ? ">" : " "
    cliOutput.log(`  ${marker} ${i + 1}. ${options[i]}`)
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners("data")
      resolve(options[defaultIndex] ?? options[0] ?? "")
    }, 30_000)

    process.stdin.once("data", (data) => {
      clearTimeout(timeout)
      const input = data.toString().trim()
      const num = parseInt(input, 10)
      if (num >= 1 && num <= options.length) {
        resolve(options[num - 1] ?? options[0] ?? "")
      } else {
        resolve(options[defaultIndex] ?? options[0] ?? "")
      }
    })
  })
}

export async function text(message: string, defaultValue = ""): Promise<string> {
  if (NON_INTERACTIVE) return defaultValue

  const hint = defaultValue ? ` [${defaultValue}]` : ""
  process.stdout.write(`${message}${hint}: `)

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners("data")
      resolve(defaultValue)
    }, 30_000)

    process.stdin.once("data", (data) => {
      clearTimeout(timeout)
      const input = data.toString().trim()
      resolve(input || defaultValue)
    })
  })
}
