/**
 * T-10.1 assertion runner.
 *
 * After `forge script EmitTestEvents` has fired 100 mixed events on Anvil
 * and `graph deploy` has uploaded the local subgraph, this script polls
 * graph-node until it catches up to the chain head, then queries the
 * deployed subgraph for entity counts and asserts the spec's expected
 * counts.
 *
 * Expected (per EmitTestEvents.s.sol):
 *   - 50 Commitment entities (one per PrivacyEntry.Deposited)
 *   - 50 Aggregation entities (one per ZkVerifier.ProofConsumed)
 *   - 2 Market entities (USDC + cbBTC; created by AssetRegistry.AssetEnabled)
 *
 * Exit code 0 on PASS, 1 on FAIL. Errors are JSON-logged so the harness
 * is easy to grep in CI.
 */
import { request } from "undici";

const GRAPHQL_URL = process.env.SUBGRAPH_URL ?? "http://localhost:8000/subgraphs/name/lending/anvil";
const POLL_INTERVAL_MS = 2_000;
const MAX_WAIT_MS = 120_000;

interface CountResponse {
  data?: {
    commitments: { id: string }[];
    aggregations: { id: string }[];
    markets: { id: string }[];
    _meta: {
      block: { number: number };
      hasIndexingErrors: boolean;
    };
  };
  errors?: { message: string }[];
}

async function gql<T>(query: string): Promise<T> {
  const res = await request(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`graph-node ${res.statusCode}: ${(await res.body.text()).slice(0, 200)}`);
  }
  return (await res.body.json()) as T;
}

const COUNT_QUERY = `
  {
    commitments(first: 1000) { id }
    aggregations(first: 1000) { id }
    markets(first: 100) { id }
    _meta { block { number } hasIndexingErrors }
  }
`;

async function waitForSync(targetBlock: number): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const r = await gql<CountResponse>(COUNT_QUERY);
      if (r.errors) {
        console.error(JSON.stringify({ msg: "graphql-error", errors: r.errors }));
      } else if (r.data) {
        const head = r.data._meta.block.number;
        if (r.data._meta.hasIndexingErrors) {
          throw new Error("subgraph reports hasIndexingErrors=true");
        }
        if (head >= targetBlock) {
          console.log(JSON.stringify({ msg: "synced", block: head, target: targetBlock }));
          return;
        }
        console.log(JSON.stringify({ msg: "waiting", block: head, target: targetBlock }));
      }
    } catch (e) {
      console.log(JSON.stringify({ msg: "poll-err", err: (e as Error).message }));
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  throw new Error(`subgraph did not reach block ${targetBlock} within ${MAX_WAIT_MS}ms`);
}

async function main() {
  // Read Anvil's current head so we know when graph-node has caught up.
  const headRes = await request("http://localhost:8545", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  const headJson = (await headRes.body.json()) as { result: string };
  const targetBlock = Number.parseInt(headJson.result, 16);
  console.log(JSON.stringify({ msg: "anvil-head", block: targetBlock }));

  await waitForSync(targetBlock);

  const r = await gql<CountResponse>(COUNT_QUERY);
  if (!r.data) throw new Error("missing data in final response");
  const got = {
    commitments: r.data.commitments.length,
    aggregations: r.data.aggregations.length,
    markets: r.data.markets.length,
  };
  const expected = { commitments: 50, aggregations: 50, markets: 2 };
  console.log(JSON.stringify({ msg: "counts", got, expected }));

  const pass =
    got.commitments === expected.commitments &&
    got.aggregations === expected.aggregations &&
    got.markets === expected.markets;

  if (!pass) {
    console.error(JSON.stringify({ msg: "T-10.1 FAIL", got, expected }));
    process.exit(1);
  }
  console.log(JSON.stringify({ msg: "T-10.1 PASS", got }));
}

main().catch((e) => {
  console.error(JSON.stringify({ msg: "crash", err: (e as Error).message }));
  process.exit(1);
});
