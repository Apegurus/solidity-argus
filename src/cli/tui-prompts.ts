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
