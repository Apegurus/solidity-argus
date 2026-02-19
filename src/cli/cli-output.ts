/**
 * Thin CLI output abstraction for user-facing CLI output.
 * Distinct from createLogger() which writes structured logs to file (~/.cache/solidity-argus/argus.log).
 * CLI output goes to stdout/stderr for user-visible formatted output (doctor reports, init messages, etc.)
 */
export const cliOutput = {
  log(...args: unknown[]): void {
    console.log(...args)
  },
  warn(...args: unknown[]): void {
    console.warn(...args)
  },
  error(...args: unknown[]): void {
    console.error(...args)
  },
}
