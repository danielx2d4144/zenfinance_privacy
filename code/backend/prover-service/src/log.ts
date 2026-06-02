import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "KURIER_API_KEY",
      "RELAYER_PRIVATE_KEY",
      "apiKey",
      "privateKey",
      "*.apiKey",
      "*.privateKey",
      "headers.authorization",
      "headers.Authorization",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
