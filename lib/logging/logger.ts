import pino, { type Logger } from 'pino';
import { getCorrelationId, getCorrelationContext } from './correlation';

const redactPaths = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'headers.cookie',
  'req.headers.cookie',
  'req.headers.authorization',
  'contentMarkdown',
  '*.contentMarkdown',
  'prompt',
  '*.prompt',
  'apiKey',
  '*.apiKey',
  'secret',
  '*.secret',
];

let baseLogger: Logger | null = null;

function createLogger(): Logger {
  const level = process.env.LOG_LEVEL ?? 'info';
  const transport =
    process.env.NODE_ENV === 'development' && level !== 'silent'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined;

  return pino({
    level,
    base: { service: process.env.SERVICE_NAME ?? 'talas-web' },
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(transport ? { transport } : {}),
  });
}

export function getLogger(): Logger {
  if (!baseLogger) baseLogger = createLogger();
  return baseLogger;
}

export function logWithContext(): Logger {
  const context = getCorrelationContext();
  return getLogger().child({
    correlationId: context?.correlationId ?? getCorrelationId(),
    ...(context?.userId ? { userId: context.userId } : {}),
  });
}

export const logger: Logger = new Proxy({} as Logger, {
  get(_target, property: string | symbol) {
    const instance = getLogger();
    const value = instance[property as keyof Logger];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

export function resetLoggerForTests(): void {
  baseLogger = null;
}
