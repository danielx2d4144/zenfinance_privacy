# Spike 1 — Critical Path End-to-End on Testnet

## 1. Goal in one sentence

**Prove that a Noir circuit, compiled with `bb` v3, submitted to Kurier,
aggregated on zkVerify, and consumed on Horizen Testnet, returns `true`
from `verifyProofAggregation(...)` on chain.**

This is the **single highest-leverage de-risking action** for the entire
design-v2 architecture. If this works, every other subsystem is "just"
more code. If this fails, we discover the problem **before** committing
months of build effort.

## 2. Success criteria (binary go/no-go)

**Pass** if, by end of Day 5:

1. `bb --version` returns v3.0.0 or later in our pinned environment.
2. A trivial Noir circuit compiles and produces a verification key.
3. We can register that VK with zkVerify Volta (or skip registration if
   inline VK works).
4. We can submit a proof to Kurier and receive `Aggregated` status with
   the full `aggregationDetails` tuple.
5. The aggregation tuple's `receiptBlockHash` is preserved before any
   other action.
6. A Solidity contract on Horizen Testnet calls
   `IVerifyProofAggregation(0x3098A6974649478f0133046e44105AA84e868C21)
   .verifyProofAggregation(...)` with the tuple from step 4 and gets
   `true` returned.
7. We can reproduce the entire flow from a fresh clone in <30 minutes.

**Fail** if any of the above doesn't work after debugging. **Document
exactly why** in the spike report; the architecture may need adjustment.

## 3. Prerequisites (Day 0)

Do these before Day 1 starts. ~2-3 hours total.

### 3.1 Accounts and faucets

| Item | Source | What you get |
|---|---|---|
| **zkVerify Volta (testnet) account** | Connect SubWallet/Talisman to `wss://zkverify-volta-rpc.zkverify.io`; faucet at `zkverify-faucet.zkverify.io` | tVFY for proof submission fees |
| **Horizen Testnet account** | Add chain to MetaMask (chainId 2651420, RPC `horizen-testnet.rpc.caldera.xyz/http`); faucet at `horizen-testnet.hub.caldera.xyz` | ETH for gas |
| **Kurier testnet API key** | Sign up at `testnet.kurier.xyz` | API key string |

Verify each by sending one test tx + one trivial API call. Block until
all three work — chasing faucet bugs mid-spike kills momentum.

### 3.2 Toolchain installation

```bash
# Noir
curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash
noirup

# Barretenberg backend (bb v3.x — UltraHonk + Keccak transcript = zkVerify-compatible)
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/master/barretenberg/bbup/install | bash
bbup -v 3.0.0    # pin exact version

# Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Node 20+ (for Kurier + zkVerifyJS scripts)
nvm install 20 && nvm use 20

# Verify versions
nargo --version    # expect ≥ 1.0.0-beta.14
bb --version       # expect 3.0.0
forge --version    # expect nightly or any recent
node --version     # expect ≥ 20
```

If any of these fail to install, **stop and fix the install** before
proceeding. A broken toolchain compounds every later step.

### 3.3 Repository layout

```bash
mkdir -p spike-01 && cd spike-01
git init
mkdir -p circuit contracts scripts artifacts
echo "node_modules/\n.env\ntarget/\nout/\nbroadcast/\nartifacts/*\n!artifacts/.gitkeep" > .gitignore
touch artifacts/.gitkeep
```

### 3.4 `.env` file (do not commit)

```
KURIER_API_URL=https://api-testnet.kurier.xyz/api/v1
KURIER_API_KEY=<paste from testnet.kurier.xyz>
ZKVERIFY_RPC=wss://zkverify-volta-rpc.zkverify.io
HORIZEN_RPC=https://horizen-testnet.rpc.caldera.xyz/http
HORIZEN_CHAIN_ID=2651420
ZKV_PROXY_HORIZEN=0x3098A6974649478f0133046e44105AA84e868C21
ZKVERIFY_DOMAIN_ID=175
ZKVERIFY_SEED="<12-word seed for Volta-funded account>"
HORIZEN_PRIVATE_KEY="0x<private key for ETH-funded Horizen account>"
```

---

## 4. Day 1 — Author and compile a minimal circuit

**Time budget: 6-8 hours.**

### 4.1 The minimal viable circuit

We need the **simplest meaningful circuit** that demonstrates Noir →
UltraHonk → zkVerify works. Don't try to build any of the actual lending
circuits yet — those come after Spike 1.

**The circuit:** prove knowledge of a preimage to a Poseidon hash.

```
private input:  x (field element)
public input:   y (field element)
assertion:      y == Poseidon([x])
```

This is ~50 constraints. Small, fast to compile, fast to prove, and
demonstrates every link in the chain.

### 4.2 Create the Noir project

```bash
cd spike-01/circuit
nargo new poseidon_preimage
cd poseidon_preimage
```

Edit `src/main.nr`:

```rust
use dep::std;

fn main(x: Field, y: pub Field) {
    let computed = std::hash::poseidon::bn254::hash_1([x]);
    assert(y == computed);
}
```

Edit `Prover.toml`:

```toml
x = "42"
y = "0x..."   # leave blank; fill after first nargo execute
```

### 4.3 Compute the expected y locally

```bash
# In a Node REPL or scratch script:
# install: npm i -g poseidon-bn254
node -e "
const p = require('poseidon-bn254');
console.log('0x' + p.hash_1(42n).toString(16));
"
```

Paste the output into `Prover.toml` as `y = "0x..."`.

### 4.4 Execute and prove

```bash
nargo execute                                        # produces target/poseidon_preimage.gz (witness)
bb prove -t evm -b ./target/poseidon_preimage.json \
         -w ./target/poseidon_preimage.gz -o ./target
bb write_vk -t evm -b ./target/poseidon_preimage.json -o ./target
```

Output files in `./target/`:
- `proof` — the ZK proof bytes
- `vk` — the verification key
- `public_inputs` — the public inputs as bytes

**Checkpoint:** if all three files exist and `bb verify` succeeds locally:

```bash
bb verify -k ./target/vk -p ./target/proof
# expected: "Proof verified successfully"
```

✅ **Day 1 done.** You have a working UltraHonk proof with all artifacts.

### 4.5 Hex-pack for zkVerify

```bash
PROOF_HEX=$(xxd -p -c 1000000 ./target/proof | tr -d '\n')
VK_HEX=$(xxd -p -c 1000000 ./target/vk | tr -d '\n')
PUBS_HEX=$(xxd -p -c 32 ./target/public_inputs | sed 's/.*/"0x&"/' | paste -sd, - | sed 's/.*/[&]/')

cat > ../../artifacts/proof.hex.json <<EOF
{
  "V3_0": {
    "ZK": "0x${PROOF_HEX}"
  }
}
EOF

echo "\"0x${VK_HEX}\"" > ../../artifacts/vk.hex
echo "${PUBS_HEX}" > ../../artifacts/pubs.hex
```

✅ **Day 1 fully done** when the three files exist in `artifacts/`.

### 4.6 Failure modes for Day 1

| Symptom | Cause | Fix |
|---|---|---|
| `nargo execute` fails | `Prover.toml` mismatched types | Re-check field encoding; field values are decimal or 0x-hex |
| `bb prove` reports incompatible version | Wrong `bb` version | `bbup -v 3.0.0` and retry |
| `y` value doesn't match | Wrong Poseidon implementation | Use `bn254`-flavored Poseidon, not 254-bit-default |
| Linker errors during `bb prove` | Old `barretenberg` | Re-install via `bbup` |

---

## 5. Day 2 — Submit to Kurier and reach `Aggregated`

**Time budget: 6-8 hours.** The aggregation wait itself eats ~5-10
minutes per iteration, so leave time for several debugging cycles.

### 5.1 First: register the verification key

Two options for VK handling on zkVerify:

| Approach | Trade-off |
|---|---|
| **Register VK once** via `registerVerificationKey` extrinsic → submit subsequent proofs with `vk: vkHash` (just the hash) | Cheaper per submission; one-time setup cost |
| **Submit VK inline on every proof** | Simpler script; pay more in fees each time |

For Spike 1 we **register once** — proves both code paths.

```bash
# scripts/01_register_vk.mjs
import { zkVerifySession, Library, CurveType } from "zkverifyjs";

const session = await zkVerifySession
  .start()
  .Volta()
  .withAccount(process.env.ZKVERIFY_SEED);

const vkJson = await fs.readFile("../artifacts/vk.hex", "utf-8");
const vk = JSON.parse(vkJson);   // "0x..."

const { regevent } = await session
  .registerVerificationKey()
  .ultrahonk({ flavour: "ZK", transcript: "Keccak" })
  .execute(vk);

regevent.on("Finalized", (e) => {
  console.log("VK registered with hash:", e.statementHash);
  fs.writeFileSync("../artifacts/vk_hash.txt", e.statementHash);
  process.exit(0);
});
```

```bash
cd scripts
npm i zkverifyjs
node 01_register_vk.mjs
```

**Checkpoint:** `artifacts/vk_hash.txt` exists with a `0x...` value.

### 5.2 Submit a proof via Kurier

```bash
# scripts/02_submit_proof.mjs
import axios from "axios";
import fs from "fs";

const API = process.env.KURIER_API_URL;
const KEY = process.env.KURIER_API_KEY;

const proof = JSON.parse(fs.readFileSync("../artifacts/proof.hex.json"));
const pubs = JSON.parse(fs.readFileSync("../artifacts/pubs.hex"));
const vkHash = fs.readFileSync("../artifacts/vk_hash.txt", "utf-8").trim();

const body = {
  proofType: "ultrahonk",
  vkRegistered: true,
  chainId: Number(process.env.HORIZEN_CHAIN_ID),  // 2651420 = Horizen testnet → domain 175
  proofOptions: {
    library: "bb",
    version: "v3.0",
    flavour: "ZK",
    transcript: "Keccak",
  },
  proofData: {
    proof: proof.V3_0.ZK,
    publicSignals: pubs,
    vk: vkHash,
  },
};

const r = await axios.post(`${API}/submit-proof/${KEY}`, body);
console.log("Job submitted:", r.data);
fs.writeFileSync("../artifacts/job_id.txt", r.data.jobId);
```

**Checkpoint:** `artifacts/job_id.txt` exists with a UUID-shaped value.
Kurier's response includes `optimisticVerify: "success"`.

### 5.3 Poll until `Aggregated`

```bash
# scripts/03_poll_aggregation.mjs
import axios from "axios";
import fs from "fs";

const API = process.env.KURIER_API_URL;
const KEY = process.env.KURIER_API_KEY;
const jobId = fs.readFileSync("../artifacts/job_id.txt", "utf-8").trim();

while (true) {
  const r = await axios.get(`${API}/job-status/${KEY}/${jobId}`);
  console.log(`[${new Date().toISOString()}] status:`, r.data.status);

  if (r.data.status === "Aggregated") {
    // CRITICAL: persist before doing anything else
    fs.writeFileSync(
      "../artifacts/aggregation.json",
      JSON.stringify(r.data.aggregationDetails, null, 2)
    );
    console.log("✓ Aggregated. Tuple saved.");
    break;
  }
  if (r.data.status === "Failed") {
    throw new Error("Kurier reported Failed: " + JSON.stringify(r.data));
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
```

**Expected runtime: 2-5 minutes** from submission to `Aggregated`.

**Checkpoint:** `artifacts/aggregation.json` contains:

```json
{
  "receipt": "0x...",
  "receiptBlockHash": "0x...",
  "root": "0x...",
  "leaf": "0x...",
  "leafIndex": <int>,
  "numberOfLeaves": <int>,
  "merkleProof": ["0x...", "0x...", ...]
}
```

The `aggregationId` and `domainId` come from the job status response
above — make sure your script captures those too. **Persist `domain_id`
and `aggregation_id`** alongside the tuple.

### 5.4 Verify the aggregation landed on Horizen

```bash
# scripts/04_check_horizen_aggregation.mjs
import { ethers } from "ethers";
const provider = new ethers.JsonRpcProvider(process.env.HORIZEN_RPC);
const proxy = new ethers.Contract(
  process.env.ZKV_PROXY_HORIZEN,
  [
    "function proofsAggregations(uint256 domainId, uint256 aggregationId) view returns (bytes32)"
  ],
  provider
);

const agg = JSON.parse(fs.readFileSync("../artifacts/aggregation.json"));
const root = await proxy.proofsAggregations(175, agg.aggregationId);
console.log("On-chain root for", agg.aggregationId, ":", root);
console.log("Tuple says root:", agg.root);
console.log(root === agg.root ? "✓ MATCH" : "✗ MISMATCH");
```

**Checkpoint:** the root from Horizen matches the root in your saved
aggregation tuple.

✅ **Day 2 done.** You've proven Noir → Kurier → zkVerify → Horizen
end-to-end.

### 5.5 Failure modes for Day 2

| Symptom | Cause | Fix |
|---|---|---|
| Kurier returns 400 | Wrong `proofType` or `proofOptions` shape | Inspect Kurier's per-prover example in `zkVerify-docs/docs/overview/02-getting-started/05-kurier.md`; copy that JSON exactly |
| Status stuck at `Queued` for >5 min | `chainId` not recognized | Confirm `2651420` is the Horizen testnet chainId; otherwise switch to `0` (Sepolia) for debugging |
| Status reaches `IncludedInBlock` but never `Aggregated` | Aggregation domain may not be configured for your `chainId` | Try domain `0` (Sepolia) instead and verify the flow works there before debugging Horizen-specific routing |
| `Failed` status with no detail | Proof itself failed verification | Re-run `bb verify` locally — proof might be malformed |
| Root mismatch on Horizen | Relayer hasn't published yet | Wait 30-60s and retry; if persistent, file a Kurier support ticket |

---

## 6. Day 3 — Consume the aggregation on Horizen

**Time budget: 6-8 hours.**

### 6.1 The minimal consumer contract

```bash
cd contracts
forge init . --no-git --no-commit
```

Replace `src/Counter.sol` with `src/PoseidonConsumer.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

interface IVerifyProofAggregation {
    function verifyProofAggregation(
        uint256 _domainId,
        uint256 _aggregationId,
        bytes32 _leaf,
        bytes32[] calldata _merklePath,
        uint256 _leafCount,
        uint256 _index
    ) external view returns (bool);
}

contract PoseidonConsumer {
    IVerifyProofAggregation public immutable zkv;
    bytes32 public immutable vkHash;

    // UltraHonk v3.0 leaf-computation constants
    bytes32 public constant PROVING_SYSTEM_ID =
        keccak256(abi.encodePacked("ultrahonk"));
    bytes32 public constant VERSION_HASH =
        sha256(abi.encodePacked("ultrahonk:v3.0"));

    event Verified(uint256 indexed aggregationId, bytes32 indexed leaf, uint256 publicY);

    constructor(address _zkv, bytes32 _vkHash) {
        zkv = IVerifyProofAggregation(_zkv);
        vkHash = _vkHash;
    }

    function computeLeaf(uint256 y) public view returns (bytes32) {
        // pubs_bytes = abi.encodePacked(y)   for one public input
        bytes32 pubsHash = keccak256(abi.encodePacked(y));
        return keccak256(abi.encodePacked(
            PROVING_SYSTEM_ID,
            vkHash,
            VERSION_HASH,
            pubsHash
        ));
    }

    function verify(
        uint256 y,                              // the public input the prover used
        uint256 domainId,                       // 175 for Horizen testnet
        uint256 aggregationId,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index
    ) external returns (bool) {
        bytes32 leaf = computeLeaf(y);
        bool ok = zkv.verifyProofAggregation(
            domainId, aggregationId, leaf, merklePath, leafCount, index
        );
        require(ok, "zkverify aggregation invalid");
        emit Verified(aggregationId, leaf, y);
        return ok;
    }
}
```

### 6.2 Foundry config for Horizen Testnet

`foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.27"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
horizen_testnet = "${HORIZEN_RPC}"

[etherscan]
horizen_testnet = { key = "${BLOCKSCOUT_KEY}", url = "https://horizen.calderaexplorer.xyz/api" }
```

### 6.3 Deploy

```bash
forge build

VK_HASH=$(cat ../artifacts/vk_hash.txt)
ZKV_PROXY=$ZKV_PROXY_HORIZEN

forge create src/PoseidonConsumer.sol:PoseidonConsumer \
  --rpc-url horizen_testnet \
  --private-key $HORIZEN_PRIVATE_KEY \
  --constructor-args $ZKV_PROXY $VK_HASH
```

**Checkpoint:** capture the deployed contract address. Save to
`artifacts/consumer_address.txt`.

### 6.4 Compare leaf computation off-chain vs on-chain

Before calling `verify`, make sure the contract computes the same leaf
the aggregation has. If these differ, `verifyProofAggregation` returns
`false` and you waste a tx debugging the wrong layer.

```bash
# scripts/05_compare_leaf.mjs
import { ethers } from "ethers";
import fs from "fs";

const consumer = new ethers.Contract(
  fs.readFileSync("../artifacts/consumer_address.txt", "utf-8").trim(),
  ["function computeLeaf(uint256 y) view returns (bytes32)"],
  new ethers.JsonRpcProvider(process.env.HORIZEN_RPC)
);

const pubs = JSON.parse(fs.readFileSync("../artifacts/pubs.hex"));
const y = pubs[0];   // we have one public input

const onChainLeaf = await consumer.computeLeaf(y);
const agg = JSON.parse(fs.readFileSync("../artifacts/aggregation.json"));

console.log("on-chain leaf:", onChainLeaf);
console.log("aggregation leaf:", agg.leaf);
console.log(onChainLeaf === agg.leaf ? "✓ MATCH" : "✗ MISMATCH");
```

**If MISMATCH:** the leaf-computation recipe is wrong. Re-check:
- The `PROVING_SYSTEM_ID` string spelling exactly matches `"ultrahonk"`.
- The `VERSION_HASH` matches what zkVerify is using (try `"ultrahonk:v3.0"`
  vs `"ultrahonk:v3"` vs `""` — the exact string is in the pallet source).
- `pubs_bytes` encoding: `abi.encodePacked(y)` for a `uint256` produces
  32 bytes big-endian; zkVerify may expect little-endian. If MISMATCH
  persists, try `_changeEndianess(y)` like the Groth16 helper does.

### 6.5 Submit the on-chain verification

```bash
# scripts/06_verify_on_chain.mjs
import { ethers } from "ethers";
import fs from "fs";

const provider = new ethers.JsonRpcProvider(process.env.HORIZEN_RPC);
const signer = new ethers.Wallet(process.env.HORIZEN_PRIVATE_KEY, provider);

const consumer = new ethers.Contract(
  fs.readFileSync("../artifacts/consumer_address.txt", "utf-8").trim(),
  [
    "function verify(uint256 y, uint256 domainId, uint256 aggregationId, bytes32[] merklePath, uint256 leafCount, uint256 index) returns (bool)",
    "event Verified(uint256 indexed aggregationId, bytes32 indexed leaf, uint256 publicY)"
  ],
  signer
);

const pubs = JSON.parse(fs.readFileSync("../artifacts/pubs.hex"));
const agg = JSON.parse(fs.readFileSync("../artifacts/aggregation.json"));

const tx = await consumer.verify(
  pubs[0],
  175,                          // Horizen testnet domain
  agg.aggregationId,
  agg.merkleProof,
  agg.numberOfLeaves,
  agg.leafIndex
);
console.log("Tx hash:", tx.hash);
const receipt = await tx.wait();
console.log("Confirmed in block:", receipt.blockNumber);
console.log("Status:", receipt.status === 1 ? "✓ SUCCESS" : "✗ REVERTED");
```

**Checkpoint:** `Status: ✓ SUCCESS` and the `Verified` event in the
receipt logs.

✅ **Day 3 done.** End-to-end critical path is empirically proven on testnet.

### 6.6 Failure modes for Day 3

| Symptom | Cause | Fix |
|---|---|---|
| Deploy reverts | Bytecode size / gas issues | Lower optimizer runs; remove constants |
| `computeLeaf` returns wrong value | Wrong constants or pubs encoding | Inspect [zkv-attestation-contracts](https://github.com/zkVerify/zkv-attestation-contracts) `ZkVerifyGroth16.sol` for the canonical encoding pattern; adapt to UltraHonk |
| `verify` reverts with "zkverify aggregation invalid" | Leaf doesn't match (most likely) or aggregation isn't on-chain yet (less likely) | Run script 04 first to confirm aggregation root is on-chain; then run script 05 to confirm leaf matches |
| `verify` reverts with "call to non-contract" | Wrong proxy address | Confirm `0x3098A6974649478f0133046e44105AA84e868C21` is the Horizen-testnet proxy (per `zkVerify-docs/docs/architecture/08-contract-addresses.md`) |

---

## 7. Day 4 — Reproducibility and timing data

**Time budget: 4-6 hours.** Now we make the spike repeatable + capture
the numbers we'll need for design assumptions.

### 7.1 Reproducible build inside Docker

```bash
# spike-01/Dockerfile
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y curl git build-essential
RUN curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash
RUN ~/.nargo/bin/noirup -v 1.0.0-beta.14
RUN curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/master/barretenberg/bbup/install | bash
RUN ~/.bb/bbup -v 3.0.0
ENV PATH="/root/.nargo/bin:/root/.bb/bin:$PATH"
WORKDIR /work
```

```bash
docker build -t spike-01-build .

docker run --rm -v $PWD:/work spike-01-build bash -c "
  cd /work/circuit/poseidon_preimage
  nargo execute
  bb prove -t evm -b ./target/poseidon_preimage.json -w ./target/poseidon_preimage.gz -o ./target
  bb write_vk -t evm -b ./target/poseidon_preimage.json -o ./target
  sha256sum ./target/proof ./target/vk
"
```

Run twice. Confirm identical sha256s.

**Checkpoint:** two independent docker runs produce **byte-identical**
proof and vk files. If not, document which fields differ — typically
this is fine for the proof (it's randomized) but vk + bytecode should
be stable.

### 7.2 Timing measurements

Capture these as we go and save to `artifacts/timing.md`:

```
Spike 1 timings on hardware: ___________ (CPU model)

Circuit compilation (nargo execute):     ____ seconds
Proof generation (bb prove):              ____ seconds
VK generation (bb write_vk):              ____ seconds
Kurier submission (POST /submit-proof):   ____ seconds
Kurier status: Queued → IncludedInBlock:  ____ seconds
Kurier status: IncludedInBlock → Aggregated: ____ minutes
Horizen tx confirmation:                  ____ seconds
TOTAL end-to-end:                         ____ minutes
```

These calibrate the latency estimates in [S04](../subsystems/04_attestation_pipeline.md)
and the "3-7 min per operation" claim in our design.

### 7.3 Browser proof timing (optional but valuable)

For a quick measure of how the same circuit performs in a browser:

```bash
# spike-01/browser-test/
# Use @aztec/bb.js to generate the same proof in-browser
npm i @aztec/bb.js
```

Write a minimal HTML page that calls `bb.js`'s prover on the same
circuit. Time the proof step in browser DevTools. Compare to the CLI
proof time.

**Checkpoint:** Save the browser proof time to `timing.md`. This
calibrates the dapp UX claim in [S07](../subsystems/07_human_frontend.md).

### 7.4 Negative test: wrong public input

Verify the contract correctly rejects a tampered proof.

```bash
# Try verify(pubs[0] + 1n, ...)
node scripts/07_verify_wrong_pubs.mjs
```

**Checkpoint:** Transaction reverts with "zkverify aggregation invalid".
Confirms the circuit binding is honest.

### 7.5 Negative test: wrong aggregationId

```bash
# Try verify(pubs[0], 175, agg.aggregationId + 1n, ...)
```

**Checkpoint:** Transaction reverts. Confirms the aggregation binding
is honest.

✅ **Day 4 done.** Reproducibility + timing + negative tests all confirmed.

---

## 8. Day 5 — Report and recommendation

**Time budget: 3-4 hours.**

### 8.1 Write the spike report

Create `spike-01/REPORT.md`. Template:

```markdown
# Spike 1 — Critical Path Spike — REPORT

## Outcome

**[PASS / FAIL]** — one-line summary

## Success criteria (from plan §2)

- [ ] bb v3.0.0 in pinned environment
- [ ] Circuit compiles and produces vk
- [ ] VK registered with zkVerify Volta (vkHash: 0x...)
- [ ] Kurier submission accepted (jobId: ...)
- [ ] Aggregation received (aggregationId: ...)
- [ ] receiptBlockHash captured: 0x...
- [ ] On-chain verifyProofAggregation returns true (tx: 0x...)
- [ ] Reproducible from fresh clone in <30 min

## Timings (from artifacts/timing.md)

| Stage | Time |
|---|---|
| Proof gen (CLI) | ... |
| Proof gen (browser) | ... |
| Submit → Aggregated | ... |
| TOTAL end-to-end | ... |

## Findings vs design assumptions

(Document anything the spike revealed that contradicts assumptions in
design-v2 docs.)

- (e.g., "VERSION_HASH for ultrahonk v3.0 is actually `"ultrahonk:v3.0"`
   per testnet — confirmed.")
- (e.g., "Browser proof was 14s on M1 MBP — design-v2 says <10s; needs
   adjustment.")
- (e.g., "Kurier returned 400 on first attempt due to `proofOptions`
   shape; correct shape is `{ library, version, flavour, transcript }`
   not `{ noir, bb, flavour }`.")

## Go / No-Go recommendation

(Based on the above, recommend whether to proceed to implementation.)

## Open follow-ups

(List anything that came up that requires a separate spike.)

## Artifacts

All saved in `artifacts/`:
- proof.hex.json, vk.hex, vk_hash.txt, pubs.hex
- job_id.txt
- aggregation.json
- consumer_address.txt
- timing.md
- Solidity build outputs in `contracts/out/`

## Reproduction instructions

```bash
git clone <repo>
cd spike-01
cp .env.example .env  # fill in faucet-funded keys + kurier API key
./scripts/run_full_spike.sh  # one-shot reproduction
```
```

### 8.2 Update design-v2 with concrete confirmations

If the spike passed, update these files with the empirical findings:

- **`design-v2/subsystems/02_zk_circuits.md`** — confirm the
  `VERSION_HASH` string for ultrahonk v3.0; update any wrong assumptions
  about proof time per circuit.
- **`design-v2/subsystems/04_attestation_pipeline.md`** — confirm the
  Kurier JSON shape for UltraHonk; update the inferred body example
  with the actual shape that worked.
- **`design-v2/subsystems/14_interest_and_apys.md`** — not affected by
  this spike; leave alone.
- **`design-v2/subsystems/01_shielded_pools.md`** — update
  `ZkVerifier.sol` leaf computation if endianness differed from
  assumption.
- **`design-v2/progress.md`** — mark Q1 as resolved.

### 8.3 The one-shot reproduction script

Wrap the day-by-day steps into one script so anyone (you, an auditor,
a new engineer, an investor's technical advisor) can reproduce the
result in 30 minutes:

```bash
# scripts/run_full_spike.sh
#!/usr/bin/env bash
set -euo pipefail
source ../.env

cd circuit/poseidon_preimage
nargo execute
bb prove -t evm -b ./target/poseidon_preimage.json -w ./target/poseidon_preimage.gz -o ./target
bb write_vk -t evm -b ./target/poseidon_preimage.json -o ./target
cd ../..
node scripts/00_pack_artifacts.mjs
node scripts/01_register_vk.mjs
node scripts/02_submit_proof.mjs
node scripts/03_poll_aggregation.mjs
node scripts/04_check_horizen_aggregation.mjs
cd contracts && forge build
VK_HASH=$(cat ../artifacts/vk_hash.txt) \
  forge create src/PoseidonConsumer.sol:PoseidonConsumer \
  --rpc-url horizen_testnet --private-key $HORIZEN_PRIVATE_KEY \
  --constructor-args $ZKV_PROXY_HORIZEN $VK_HASH \
  | tee ../artifacts/deploy_log.txt
node ../scripts/05_compare_leaf.mjs
node ../scripts/06_verify_on_chain.mjs
echo "✓ Full spike completed."
```

✅ **Day 5 done.** You have a passing (or failing) spike with full report.

---

## 9. Decision tree based on outcome

### 9.1 If PASS

- Update `design-v2/progress.md` Q1 to `[x] passed`.
- Tag the spike repo at `v0.1.0-spike-01`.
- Pin all toolchain versions (Noir, bb, solc) in `design-v2/spikes/PINNED_VERSIONS.md`.
- **Begin implementation** — the critical path is empirically de-risked.
  First implementation milestone should be S01 contracts using the
  exact `VERSION_HASH` and leaf-computation pattern from the spike.

### 9.2 If FAIL — and the failure is on the zkVerify side

- File an issue with zkVerify maintainers including:
  - Job ID + aggregation ID
  - Exact submission JSON
  - Expected vs actual leaf
  - Reproduction script
- Wait for response (typically 1-3 business days based on community
  observation).
- In parallel: spike the **fallback path** — submit the same proof via
  **zkVerifyJS direct** instead of Kurier. If that works, the design
  is unblocked at higher operational cost (we run our own zkVerify
  session instead of using Kurier).

### 9.3 If FAIL — and the failure is on the leaf-computation side

- This is the most concerning case. It means our understanding of
  `verifyProofAggregation`'s expected leaf shape is wrong.
- Inspect `referenced_repos/zkVerify_zkv-attestation-contracts/contracts/verifiers/ZkVerifyGroth16.sol`
  byte-for-byte (we already cloned it).
- Compare to a known-good integration: examine `JetHalo/zk-Escrow`'s
  on-chain verifier (their domain `2` setup on Base Sepolia).
- Adapt our `PoseidonConsumer.computeLeaf` until it matches.
- This may also reveal that we need a `ZkVerifyUltraHonk.sol` helper
  that doesn't exist in `zkv-attestation-contracts` yet — write a
  minimal one based on the existing `ZkVerifyGroth16.sol` pattern.

### 9.4 If FAIL — and the failure is "everything works but it's too slow"

If end-to-end takes >10 minutes consistently (instead of the budgeted
3-7), this is a UX risk but not a feasibility risk.
- Note the actual timing in the report.
- Adjust the latency claim in design-v2 throughout.
- Consider whether the user UX still works at the measured speed —
  some operations may need a "fire and forget + email when done"
  UX instead of a progress bar.

---

## 10. What this spike DOESN'T prove

Be honest: Spike 1 proves the **critical path works for one simple
circuit**. It does NOT prove:

- That a real lending circuit (multi-asset HF check, ~13k constraints)
  fits within zkVerify's UltraHonk pallet limits — needs **Spike 6**.
- That ERC-4337 EntryPoint is deployed on Horizen — needs **Spike 2**.
- That Solidity contracts can be reproducibly built across machines —
  needs **Spike 3**.
- That `AssetRegistry`, `PrivacyEntry`, the policy engine, etc. all
  compose correctly — only the full implementation will prove this.

**Spike 1 is necessary but not sufficient.** It removes the largest
single unknown — "does our trust chain even work end-to-end?" — and
makes the rest of implementation a matter of execution rather than
discovery.

---

## 11. Budget summary

| Day | Activity | Time | Risk if it fails |
|---|---|---|---|
| 0 | Setup, accounts, faucets, toolchain | 2-3 h | Low — well-documented |
| 1 | Author + compile minimal circuit | 6-8 h | Low — Noir is mature |
| 2 | Submit to Kurier + reach Aggregated | 6-8 h | **Medium** — Kurier shape may differ; aggregation timing variable |
| 3 | On-chain consumer + verifyProofAggregation | 6-8 h | **High** — leaf computation is the most error-prone step |
| 4 | Docker reproducibility + timing + neg tests | 4-6 h | Low — engineering exercise |
| 5 | Report + design updates + go/no-go | 3-4 h | Low — administrative |
| **Total** | | **~27-37 hours** | One engineer-week with buffer |

Total cost: **~$3,000-5,000 of engineer time + ~$50 in testnet
gas/fees.** Compare to the alternative: starting full implementation
without this spike and discovering at week 8 that the leaf computation
was wrong. That alternative is at least 100× more expensive.

---

## 12. Who runs this

Ideal candidate: **one engineer comfortable with TypeScript/Node + has
touched Solidity before**. ZK familiarity helps but isn't required —
the circuit is trivial and `nargo` + `bb` are well-documented.

If you're hiring this person: a senior generalist with prior bridge or
oracle-consumer experience is the right fit. Budget 1 week of their
time + your time for daily 15-min syncs.

---

## 13. Deliverables on Day 5

| Artifact | Why |
|---|---|
| `REPORT.md` | Documents the outcome for stakeholders |
| `artifacts/` directory | Reproducible artifacts; auditors can recompute |
| `scripts/run_full_spike.sh` | One-shot re-execution |
| `Dockerfile` | Reproducible toolchain for the entire spike |
| `PINNED_VERSIONS.md` | Exact tool versions to lock into the production build pipeline |
| Updated `design-v2/progress.md` | Q1 marked passed (or open spike-1.1 if failed) |
| Updated `design-v2/subsystems/02_zk_circuits.md` and `04_attestation_pipeline.md` | Replace inferred values with empirical ones |
| One blog post (optional) | "We verified a ZK proof on Horizen via zkVerify" — useful for marketing, hiring, and community |

---

## 14. After Spike 1 passes

The 5 remaining bounded spikes can run in parallel with implementation:

| Spike | Goal | Day budget |
|---|---|---|
| **Spike 2** | ERC-4337 EntryPoint confirmed/deployed on Horizen | 2 |
| **Spike 3** | Reproducible Solidity builds in pinned Docker | 2 |
| **Spike 4** | Stork live integration on Horizen Testnet | 1 |
| **Spike 5** | Browser-side proof time for a 13k-constraint circuit | 1 |
| **Spike 6** | Multi-asset HF circuit fits zkVerify pallet limits | 3 |

Each can be a separate `spikes/0N_*.md` plan written when needed.
Total Spike 2-6 budget: **~9 days across them**, parallelizable.

After all 6 pass, the design is fully de-risked and implementation is
pure execution.
