import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface LoggerConfig {
  debug?: boolean
}

export interface Logger {
  info(...args: unknown[]): void
  debug(...args: unknown[]): void
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
}

type LogSink = (line: string) => void

const LOG_DIR = join(homedir(), ".cache", "solidity-argus")
const LOG_FILE = join(LOG_DIR, "argus.log")

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
  }
}

function safeStringify(a: unknown): string {
  if (typeof a === "string") return a
  try {
    return JSON.stringify(a)
  } catch {
    try {
      return String(a)
    } catch {
      return "[Unserializable value]"
    }
  }
}

function formatLine(level: string, args: unknown[]): string {
  const ts = new Date().toISOString()
  const msg = args.map(safeStringify).join(" ")
  return `${ts} [${level}] ${msg}\n`
}

function createFileSink(): LogSink {
  let dirReady = false
  return (line: string) => {
    if (!dirReady) {
      ensureLogDir()
      dirReady = true
    }
    try {
      appendFileSync(LOG_FILE, line)
    } catch {
      // if we can't write logs, we don't crash the plugin
    }
  }
}

function createStderrSink(): LogSink {
  return (line: string) => {
    process.stderr.write(line)
  }
}

function resolveSink(): LogSink {
  const mode = process.env.ARGUS_LOG
  if (mode === "stderr") return createStderrSink()
  return createFileSink()
}

let sharedSink: LogSink | null = null

function getSink(): LogSink {
  if (!sharedSink) {
    sharedSink = resolveSink()
  }
  return sharedSink
}

export function createLogger(config: LoggerConfig = {}): Logger {
  const { debug = false } = config

  return {
    info(...args: unknown[]): void {
      getSink()(formatLine("INFO", args))
    },

    debug(...args: unknown[]): void {
      if (debug) {
        getSink()(formatLine("DEBUG", args))
      }
    },

    error(...args: unknown[]): void {
      getSink()(formatLine("ERROR", args))
    },

    warn(...args: unknown[]): void {
      getSink()(formatLine("WARN", args))
    },
  }
}

export function resetLoggerSink(): void {
  sharedSink = null
}

export { LOG_FILE, LOG_DIR }
