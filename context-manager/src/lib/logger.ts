export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  return level && ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
}

export function createLogger(tag: string) {
  const logLevel = getLogLevel();
  const shouldDebug = logLevel === 'debug' || process.env.DEBUG;

  return {
    info(...args: unknown[]) {
      console.log(`[${tag}]`, ...args);
    },
    warn(...args: unknown[]) {
      console.warn(`[${tag}]`, ...args);
    },
    error(...args: unknown[]) {
      console.error(`[${tag}]`, ...args);
    },
    debug(...args: unknown[]) {
      if (shouldDebug) {
        console.debug(`[${tag}]`, ...args);
      }
    },
  };
}
