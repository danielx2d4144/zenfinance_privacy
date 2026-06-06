import type { FastifyReply, FastifyRequest } from "fastify";
import { getConfig } from "./config.js";

/**
 * X-API-Key gate. Day-11 surface is intentionally simple: a single shared
 * key from the env. SIWE-issued JWTs land Day 14 when Subsystem 07 (the
 * dapp) lands; per S13 §4.1 both auth schemes are first-class.
 *
 * Rejects with structured 401 error per S13 §6 error model.
 */
export async function requireApiKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const headerKey = req.headers["x-api-key"];
  const supplied = typeof headerKey === "string" ? headerKey : Array.isArray(headerKey) ? headerKey[0] : undefined;
  if (!supplied || supplied !== getConfig().API_KEY) {
    reply.code(401).send({
      code: "AUTH_INVALID",
      message: "Missing or invalid X-API-Key",
      retryable: false,
    });
  }
}
