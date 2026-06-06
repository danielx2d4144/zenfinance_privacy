import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/health", async () => ({
    status: "ok",
    version: "0.2.0",
    day: 11,
  }));
}
