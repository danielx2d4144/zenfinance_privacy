import Fastify, { type FastifyInstance } from "fastify";
import { getConfig } from "./config.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerIntentRoutes } from "./routes/intents.js";
import { registerOpenApiRoutes } from "./routes/openapi.js";
import { registerMcpRoutes } from "./mcp/server.js";

/**
 * Build the Fastify app without binding to a port. Tests reuse this to
 * exercise endpoints in-process via `app.inject()`.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const cfg = getConfig();
  // pino-pretty isn't a dependency; use the plain JSON logger. Day-N+
  // can swap in pino-pretty under dev if someone wants colour locally.
  const app = Fastify({ logger: { level: cfg.LOG_LEVEL } });

  await registerHealthRoutes(app);
  await registerIntentRoutes(app);
  await registerOpenApiRoutes(app);
  await registerMcpRoutes(app);

  return app;
}

async function main() {
  const cfg = getConfig();
  const app = await buildApp();
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
}

import { pathToFileURL } from "node:url";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
