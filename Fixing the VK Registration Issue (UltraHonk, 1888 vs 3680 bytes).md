# Fixing the VK Registration Issue (UltraHonk, 1888 vs 3680 bytes)

## Root cause

The 3680-byte VK you are getting is the default Poseidon2 output of bb, which is meant for recursion (proofs verified inside another circuit).

For on-chain verification with zkVerify, you need the Keccak format, which is 1888 bytes. Same circuit, same bb version, just a different generation option. No downgrade needed.

We verified this locally on the latest bb (v5.2.0):
- default (Poseidon2): VK = 3680 bytes
- keccak: VK = 1888 bytes

## Fix for bb.js (browser proving, your current setup)

Pass `keccakZK: true` when generating proofs and when exporting the verification key:

```javascript
// generate the proof
const proof = await backend.generateProof(witness, { keccakZK: true });
const vk = await backend.getVerificationKey({ keccakZK: true });
```

**Important:** use `keccakZK: true`, NOT `keccak: true`. The plain keccak option produces the non-ZK flavor of UltraHonk, and zkVerify only accepts the ZK flavor.

## Fix for bb CLI (3.0.x)

```bash
bb write_vk -b <circuit.json> -w <witness.gz> -o <out_dir> --oracle_hash keccak

bb prove -b <circuit.json> -w <witness.gz> -k <vk_path> -o <out_dir> --oracle_hash keccak
```

The flag must be used consistently on prove and verify.

Official CLI reference: https://barretenberg.aztec.network/docs/bb-cli-reference

**Note for newer bb versions (5.x):** the CLI flags changed. `--oracle_hash` was replaced by the `--verifier_target` option, so the equivalent commands are:

```bash
bb write_vk -b <circuit.json> -o <out_dir> -t evm

bb prove -b <circuit.json> -w <witness.gz> -k <vk_path> -o <out_dir> -t evm
```

This is the exact setup we used in our local verification (bb v5.2.0): default target produced a 3680-byte VK, `-t evm` produced a 1888-byte VK.

## Sanity check

The regenerated VK must be exactly 1888 bytes. If it is still 3680 bytes, the option did not take effect.

## Next step

Register the keccak VK with Kurier again (UltraHonk variant V3_0) and submit your proof. The chain has supported the bb v3.x toolchain since runtime v1.6.0 (see https://docs.zkverify.io/architecture/verification_pallets/ultrahonk).

If register-vk still rejects the 1888-byte VK, send us the exact request and error, and we will investigate the Kurier side.
