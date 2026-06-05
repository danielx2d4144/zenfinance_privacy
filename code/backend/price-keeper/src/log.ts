import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.RELAYER_PRIVATE_KEY",
      "*.STORK_API_TOKEN",
      "*.privateKey",
      "*.token",
      "*.signature",
      "*.r",
      "*.s",
    ],
    censor: "[REDACTED]",
  },
});
