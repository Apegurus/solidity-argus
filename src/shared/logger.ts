export interface LoggerConfig {
  debug?: boolean;
}

export interface Logger {
  info(...args: any[]): void;
  debug(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
}

export function createLogger(config: LoggerConfig = {}): Logger {
  const { debug = false } = config;

  const prefix = "[argus]";

  return {
    info(...args: any[]): void {
      console.error(prefix, ...args);
    },

    debug(...args: any[]): void {
      if (debug) {
        console.error(prefix, ...args);
      }
    },

    error(...args: any[]): void {
      console.error(prefix, ...args);
    },

    warn(...args: any[]): void {
      console.error(prefix, ...args);
    },
  };
}
