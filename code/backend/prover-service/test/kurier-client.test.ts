import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { KurierClient } from "../src/kurier/client.js";
import {
  KurierError,
  KurierRateLimited,
  KurierResponseShapeError,
  KurierVkNotRegistered,
} from "../src/kurier/errors.js";

const BASE = "https://relayer-mock.local";
const KEY = "x".repeat(40);

let agent: MockAgent;
let pool: ReturnType<MockAgent["get"]>;
let client: KurierClient;

beforeAll(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterAll(async () => {
  await agent.close();
});

afterEach(() => {
  pool.close();
});

function makeClient() {
  pool = agent.get(BASE);
  return new KurierClient({
    baseUrl: BASE,
    apiKey: KEY,
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 4, jitter: false },
  });
}

describe("KurierClient.registerVk", () => {
  it("returns parsed vkHash on 200", async () => {
    client = makeClient();
    pool
      .intercept({ path: `/register-vk/${KEY}`, method: "POST" })
      .reply(200, { vkHash: "0xabcdef" });
    const res = await client.registerVk({ proofType: "ultrahonk", proofOptions: { variant: "ZK", version: "V3_0" }, vk: "0xdead" });
    expect(res.vkHash).toBe("0xabcdef");
  });

  it("throws KurierResponseShapeError on malformed body", async () => {
    client = makeClient();
    pool
      .intercept({ path: `/register-vk/${KEY}`, method: "POST" })
      .reply(200, { wrongField: true });
    await expect(client.registerVk({ proofType: "ultrahonk", proofOptions: { variant: "ZK", version: "V3_0" }, vk: "0x00" })).rejects.toBeInstanceOf(
      KurierResponseShapeError,
    );
  });
});

describe("KurierClient.submitProof", () => {
  it("returns parsed jobId on 200", async () => {
    client = makeClient();
    pool
      .intercept({ path: `/submit-proof/${KEY}`, method: "POST" })
      .reply(200, { jobId: "job-1" });
    const res = await client.submitProof({
      proofType: "ultrahonk",
      proofOptions: { variant: "ZK", version: "V3_0" },
      vkRegistered: true,
      proofData: { proof: "0x00", publicSignals: ["0x00"], vk: "0x00" },
    });
    expect(res.jobId).toBe("job-1");
  });

  it("throws KurierVkNotRegistered on 400 with 'vk not registered' message", async () => {
    client = makeClient();
    pool
      .intercept({ path: `/submit-proof/${KEY}`, method: "POST" })
      .reply(400, { message: "Provided vk not registered with relayer" });
    await expect(
      client.submitProof({
        proofType: "ultrahonk",
        proofOptions: { variant: "ZK", version: "V3_0" },
        vkRegistered: false,
        proofData: { proof: "0x00", publicSignals: [], vk: "0x00" },
      }),
    ).rejects.toBeInstanceOf(KurierVkNotRegistered);
  });

  it("retries on 5xx then succeeds", async () => {
    client = makeClient();
    pool
      .intercept({ path: `/submit-proof/${KEY}`, method: "POST" })
      .reply(503, { message: "upstream busy" });
    pool
      .intercept({ path: `/submit-proof/${KEY}`, method: "POST" })
      .reply(200, { jobId: "job-2" });
    const res = await client.submitProof({
      proofType: "ultrahonk",
      proofOptions: { variant: "ZK", version: "V3_0" },
      vkRegistered: true,
      proofData: { proof: "0x00", publicSignals: [], vk: "0x00" },
    });
    expect(res.jobId).toBe("job-2");
  });

  it("does NOT retry on 4xx (other than 429)", async () => {
    client = makeClient();
    pool
      .intercept({ path: `/submit-proof/${KEY}`, method: "POST" })
      .reply(400, { message: "malformed proof" });
    await expect(
      client.submitProof({
        proofType: "ultrahonk",
        proofOptions: { variant: "ZK", version: "V3_0" },
        vkRegistered: true,
        proofData: { proof: "0x00", publicSignals: [], vk: "0x00" },
      }),
    ).rejects.toBeInstanceOf(KurierError);
  });

  it("surfaces 429 as KurierRateLimited after exhausting retries", async () => {
    client = makeClient();
    for (let i = 0; i < 3; i++) {
      pool
        .intercept({ path: `/submit-proof/${KEY}`, method: "POST" })
        .reply(429, { message: "slow down" }, { headers: { "retry-after": "0" } });
    }
    await expect(
      client.submitProof({
        proofType: "ultrahonk",
        proofOptions: { variant: "ZK", version: "V3_0" },
        vkRegistered: true,
        proofData: { proof: "0x00", publicSignals: [], vk: "0x00" },
      }),
    ).rejects.toBeInstanceOf(KurierRateLimited);
  });
});

describe("KurierClient.getJobStatus", () => {
  it("returns parsed status on 200", async () => {
    client = makeClient();
    pool
      .intercept({ path: `/job-status/${KEY}/job-1`, method: "GET" })
      .reply(200, {
        status: "Aggregated",
        aggregationId: 7,
        aggregationDetails: {
          receipt: "0xb87e",
          receiptBlockHash: "0x871f",
          root: "0xb87e",
          leaf: "0x1e53",
          leafIndex: 2,
          numberOfLeaves: 4,
          merkleProof: ["0xab", "0xcd"],
        },
      });
    const res = await client.getJobStatus("job-1");
    expect(res.status).toBe("Aggregated");
    expect(res.aggregationId).toBe(7);
    expect(res.aggregationDetails?.leafIndex).toBe(2);
    expect(res.aggregationDetails?.merkleProof).toHaveLength(2);
  });
});
