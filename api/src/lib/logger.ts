type LogLevel = 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  level: LogLevel;
  message: string;
  requestId: string;
  userId: string;
  handler: string;
  timestamp: string;
  error?: { name: string; message: string; stack?: string };
}

export function createLogger(handler: string) {
  function log(level: LogLevel, message: string, requestId: string, userId: string, err?: unknown) {
    const entry: LogEntry = {
      level,
      message,
      requestId,
      userId,
      handler,
      timestamp: new Date().toISOString(),
    };

    if (err instanceof Error) {
      const isProduction = process.env.ENVIRONMENT === 'production';
      entry.error = {
        name: err.name,
        message: err.message,
        ...(isProduction ? {} : { stack: err.stack ?? '' }),
      };
    }

    // Structured JSON to stdout — CloudWatch picks it up automatically.
    // Suppress output during test runs to keep vitest output clean.
    if (process.env.VITEST) return;
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  return {
    info: (message: string, requestId: string, userId: string) =>
      log('INFO', message, requestId, userId),
    warn: (message: string, requestId: string, userId: string) =>
      log('WARN', message, requestId, userId),
    error: (message: string, requestId: string, userId: string, err?: unknown) =>
      log('ERROR', message, requestId, userId, err),
  };
}
