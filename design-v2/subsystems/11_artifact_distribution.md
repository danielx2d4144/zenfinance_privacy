# Subsystem 11 — Artifact Distribution

## 1. Purpose

Makes the protocol's binaries — **Solidity contracts**, **Noir circuits +
verifying keys**, **SDK packages**, **MCP server image** — publicly
auditable, reproducibly built, and content-addressable. So that an
independent observer can verify:

> "The pool at 0x… is byte-for-byte the deployed bytecode of
> `ShieldedSupplyPool.sol` at git commit X, built reproducibly inside the
> pinned Docker image; the borrow circuit's vk hash 0x… registered with
> zkVerify is the same circuit committed in repo at commit Y."

Without this, the privacy claim is "trust us." With it, the claim is
**cryptographically checkable**.

## 2. Artifacts under management

| Kind | Build tool | What's pinned |
|---|---|---|
| **Solidity contracts** (8 contracts) | Foundry inside `ghcr.io/foundry-rs/foundry:nightly-<sha>` | solc version, optimizer settings, libs |
| **Noir circuits + vkeys** (7 circuits) | `nargo` + `bb` inside `aztecprotocol/noir:<version>` | noir version, bb version, target flavour (ZK), transcript hash (Keccak) |
| **SDKs** (TS + Python) | `pnpm` / `pip` build | Node version, dep lockfile, build script |
| **MCP server Docker image** | `docker buildx` inside `alpine:<sha>` | base image sha, build args |
| **Audit reports** (PDF + provenance) | manual upload | SHA-256 of the PDF |

Everything pinned by exact version + cryptographic identifier.

## 3. The build pipeline

### 3.1 Per-release

```yaml
# .github/workflows/release.yml (sketch)
on:
  push:
    tags: ['v*']
jobs:
  build-and-pin:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@<sha>
        with: { ref: '${{ github.sha }}' }

      - name: Build contracts in pinned Foundry container
        run: |
          docker run --rm -v "$PWD:/work" -w /work \
            ghcr.io/foundry-rs/foundry:nightly-${{ env.FOUNDRY_SHA }} \
            forge build --use ${{ env.SOLC }} --optimize --optimizer-runs 200
          sha256sum out/*.json > artifacts-contracts.sha256

      - name: Build Noir circuits in pinned Noir container
        run: |
          docker run --rm -v "$PWD:/work" -w /work \
            aztecprotocol/noir:${{ env.NOIR_VERSION }} \
            sh -c 'for c in deposit_supply withdraw_supply borrow ...; do
              cd circuits/$c && nargo execute && bb prove -t evm ... && bb write_vk -t evm ...; done'
          sha256sum target/*.{proof,vk} > artifacts-circuits.sha256

      - name: Pin to IPFS via Pinata
        run: |
          ./scripts/pin.sh

      - name: Register on-chain
        run: |
          # Safe-driven; pre-approved tx with the new manifest
          cast send $REGISTRY "register(...)" $(cat manifest.json)

      - name: Create GitHub Release with all artifacts + audit report links
```

### 3.2 Manifest schema

```json
{
  "release": "v1.0.0",
  "git_commit": "abc1234...",
  "git_tag": "v1.0.0",
  "released_at": "2026-09-15T12:00:00Z",
  "artifacts": {
    "contracts": {
      "build_image": "ghcr.io/foundry-rs/foundry:nightly-abc...",
      "solc_version": "0.8.27",
      "items": [
        {
          "name": "ShieldedSupplyPool",
          "bytecode_sha256": "0x...",
          "deployed_at": "0x..."
        },
        ...
      ]
    },
    "circuits": {
      "build_image": "aztecprotocol/noir:v1.0.0-beta.14+bb-v3.0.0",
      "items": [
        {
          "name": "deposit_supply",
          "proof_sha256": "0x...",
          "vk_sha256": "0x...",
          "vk_hash_zkverify": "0x...",
          "registered_at_block": 12345
        },
        ...
      ]
    },
    "sdks": {
      "ts": { "package": "@lending/agent-sdk", "version": "1.0.0", "tarball_sha256": "0x..." },
      "py": { "package": "lending-agent-py",   "version": "1.0.0", "wheel_sha256": "0x..." }
    },
    "mcp_server": {
      "image": "ghcr.io/our-org/lending-mcp:1.0.0",
      "image_digest_sha256": "0x..."
    }
  },
  "audit": [
    {
      "auditor": "Cantina",
      "report_url": "ipfs://bafy...",
      "report_sha256": "0x...",
      "scope": ["contracts", "circuits"],
      "completed_at": "2026-09-01"
    },
    {
      "auditor": "Veridise",
      "report_url": "ipfs://bafy...",
      "report_sha256": "0x...",
      "scope": ["circuits"],
      "completed_at": "2026-09-05"
    }
  ],
  "ipfs_cid": "bafy..."
}
```

## 4. On-chain registry

```solidity
contract ProtocolArtifactRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN");

    struct Release {
        string  semver;
        bytes32 manifestSha256;
        string  ipfsCid;
        uint64  publishedAt;
        bool    revoked;        // for compromised releases
    }

    Release[] public releases;
    function publish(Release calldata r) external onlyRole(ADMIN_ROLE);
    function revoke(uint256 idx) external onlyRole(ADMIN_ROLE);

    event Published(uint256 indexed idx, string semver,
                    bytes32 manifestSha256, string ipfsCid);
    event Revoked(uint256 indexed idx);
}
```

Anyone can read this and fetch the manifest from IPFS. Anyone can re-build
locally and compare hashes.

## 5. Verification script (shipped publicly)

```bash
# verify-release.sh v1.0.0
#
# 1. Fetch the release's manifest from on-chain.
# 2. Download artifacts from IPFS by CID.
# 3. Reproduce builds locally inside the pinned Docker images.
# 4. Compare local SHA-256s to the manifest's.
# 5. PASS or FAIL with diff details.

set -euo pipefail
VERSION="${1:?usage: verify-release.sh v1.0.0}"
MANIFEST=$(cast call $REGISTRY "manifestForVersion(string)(bytes32)" "$VERSION")
CID=$(cast call $REGISTRY "ipfsForVersion(string)(string)" "$VERSION")
ipfs get "$CID" -o release/
docker run --rm -v "$PWD/release:/work" -w /work \
   ghcr.io/foundry-rs/foundry:nightly-${FOUNDRY_SHA} \
   forge build --use 0.8.27 --optimize --optimizer-runs 200
# ... continues with circuits, SDKs, MCP image
diff <(sha256sum out/*.json) <(jq -r '.artifacts.contracts.items[].bytecode_sha256' manifest.json)
```

## 6. IPFS pinning lifecycle

- **All releases pinned forever.** Storage is cheap; historical auditability
  is critical.
- **Two pinning services** (Pinata + Filebase) for redundancy.
- **Audit PDFs** pinned with their reports.
- **Revoked releases** stay pinned but flagged on-chain (so historical
  reproducibility for forensics still works).

## 7. Solidity reproducible-build notes

Reproducible Solidity is **notoriously fiddly**. Specific traps:

- **Metadata hash** depends on the absolute path of source files. Mitigate
  by building inside the Docker container with a fixed working directory.
- **Optimizer differences** across solc patch versions. Pin exact patch.
- **IPFS / Swarm metadata appended** by solc. Either disable (`--no-cbor-metadata`)
  or pin the IPFS hash referenced in the metadata.
- **Library deployments** can change addresses between deployments. Use
  CREATE2 deployment with deterministic addresses.

Plan: do a first reproducible-build dry run in the spike phase to confirm
the recipe works on Horizen-deployed bytecode. If not, fall back to
"source-verified" via the standard `forge verify-contract` path while we
debug.

## 8. Agent accessibility notes

The MCP server itself is one of the artifacts. The MCP server image being
deterministically reproducible means agents can verify the **protocol's
own backend code** is what we claim. This matters for any agent operating
on behalf of a high-stakes principal — they (or their owner) want to know
what binary is processing their requests.

## 9. Dependencies

- Pinata + Filebase IPFS pinning APIs.
- GitHub Actions for CI.
- Foundry Docker image.
- Noir Docker image.
- A deterministic Docker base for the MCP server.
- Den Safe (for registry writes).

## 10. Diagram

```mermaid
flowchart TB
  REPO[github.com/our-org/lending<br/>tag pushed]
  CI[GitHub Actions release.yml]

  subgraph Builds in pinned containers
    FORGE[forge build<br/>foundry:<sha>]
    NOIR_BB[nargo + bb<br/>noir:<sha>]
    SDK_TS[pnpm build<br/>node:<sha>]
    SDK_PY[poetry build<br/>python:<sha>]
    DOCKER_MCP[docker buildx<br/>alpine:<sha>]
  end

  subgraph Artifacts
    CONTRACTS[8 contract JSONs]
    CIRCUITS[7 circuit (proof, vk, vk_zkv) bundles]
    TS_NPM[@lending/agent-sdk]
    PY_PIP[lending-agent-py]
    MCP_IMG[MCP Docker image]
  end

  subgraph Public
    IPFS[(IPFS, pinned x 2)]
    NPM[npm registry]
    PYPI[PyPI registry]
    GHCR[GHCR Docker registry]
  end

  subgraph Horizen
    REG[ProtocolArtifactRegistry]
    POOLS[Deployed contracts]
  end

  USER[Auditor / power user / agent]
  VERIFY[verify-release.sh]

  REPO --> CI
  CI --> FORGE --> CONTRACTS
  CI --> NOIR_BB --> CIRCUITS
  CI --> SDK_TS --> TS_NPM
  CI --> SDK_PY --> PY_PIP
  CI --> DOCKER_MCP --> MCP_IMG

  CONTRACTS --> IPFS
  CIRCUITS --> IPFS
  TS_NPM --> NPM
  PY_PIP --> PYPI
  MCP_IMG --> GHCR
  MCP_IMG --> IPFS

  SAFE[Safe] -- publish(manifest) --> REG
  CI -- prep manifest tx for Safe --> SAFE

  REG -- public read --> USER
  IPFS -- public fetch --> USER
  USER --> VERIFY
  VERIFY -- diff local vs manifest --> USER

  CONTRACTS -. deployed at .-> POOLS
```
