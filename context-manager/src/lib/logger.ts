export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  return level && ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
}

function shouldLog(configuredLevel: LogLevel, messageLevel: LogLevel): boolean {
  return LOG_LEVELS[messageLevel] >= LOG_LEVELS[configuredLevel];
}

export function createLogger(tag: string) {
  const logLevel = getLogLevel();

  return {
    info(...args: unknown[]) {
      if (shouldLog(logLevel, 'info')) {
        console.log(`[${tag}]`, ...args);
      }
    },
    warn(...args: unknown[]) {
      if (shouldLog(logLevel, 'warn')) {
        console.warn(`[${tag}]`, ...args);
      }
    },
    error(...args: unknown[]) {
      if (shouldLog(logLevel, 'error')) {
        console.error(`[${tag}]`, ...args);
      }
    },
    debug(...args: unknown[]) {
      if (shouldLog(logLevel, 'debug') || process.env.DEBUG) {
        console.debug(`[${tag}]`, ...args);
      }
    },
  };
}
