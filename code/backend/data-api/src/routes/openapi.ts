import type { FastifyInstance } from "fastify";
import { buildOpenApiSpec } from "../openapi.js";

export async function registerOpenApiRoutes(app: FastifyInstance): Promise<void> {
  const spec = buildOpenApiSpec();
  app.get("/v1/openapi.json", async (_req, reply) => {
    reply.send(spec);
  });
}
