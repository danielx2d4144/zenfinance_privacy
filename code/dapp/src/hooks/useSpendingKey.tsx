"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { LocalIMT } from "@/lib/imt.ts";
import { NoteStore } from "@/lib/note-store.ts";
import { spendingPubkeyOf } from "@/lib/witness.ts";
import {
  canonicalRS,
  keyDerivationTypedData,
  sessionKeysFromSignature,
} from "@/lib/key-derivation.ts";
import { NoteVault, type VaultUnavailableReason } from "@/lib/note-vault.ts";
import { TabLock, type TabRole } from "@/lib/tab-lock.ts";
import { getChainConfig } from "@/lib/chain-config.ts";
import { makeFetchLogs, makeScanClient } from "@/lib/recovery-adapter.ts";
import { RecoveryScanner, recoverNotes } from "@/lib/recovery-scan.ts";
import { buildCommitmentIndex, reconcileWal } from "@/lib/commitment-matcher.ts";

import { useWallet } from "./useWallet.ts";

/**
 * M2.6 session provider — the unlock ceremony (ADR-002).
 *
 * One EIP-712 signature derives spending/viewing/storage keys
 * (key-derivation.ts). First unlock per {chainId, address} additionally
 * runs the sign-twice determinism check: a signer that returns two
 * different signatures (MPC / smart wallet) cannot re-derive keys later,
 * so unlock is BLOCKED with an explicit warning rather than letting the
 * user deposit unrecoverable funds. The passed-check marker (a boolean,
 * never key material) lives in localStorage.
 *
 * After key derivation: open the encrypted NoteVault (hydrate the
 * in-memory NoteStore, then attach the write-through mirror), acquire
 * the cross-tab writer lock, and — writer only — run WAL reconciliation
 * plus the background memo-recovery scan.
 *
 * Keys stay in React state only (I-CRYPTO-1); the vault holds
 * ciphertext at rest under the storage key.
 */

export type RecoveryState =
  | { status: "idle" }
  | { status: "scanning"; scannedTo: bigint; head: bigint }
  | { status: "done"; recovered: number; walPromoted: number }
  | { status: "error"; message: string };

type SpendingKeyContextValue = {
  /** True once the ceremony completed and keys are in memory. */
  unlocked: boolean;
  /** Field-reduced secret_key (bigint < BN254_FR). */
  secretKey: bigint | null;
  /** Cached spending_pubkey = h([TAG_SPENDING_PUBKEY, secret_key]). */
  spendingPubkey: bigint | null;
  /** Memo viewing key (32 bytes) — deposit memo encryption + recovery. */
  viewingKey: Uint8Array | null;
  /** Local mirror of PrivacyEntry's Poseidon2 IMT. */
  entryImt: LocalIMT;
  /** Local mirror of ShieldedSupplyPool's Poseidon2 IMT. */
  supplyImt: LocalIMT;
  /** Local mirror of ShieldedPositionPool's Poseidon2 IMT. */
  positionImt: LocalIMT;
  /** Session note store: leaf -> typed preimage (vault-mirrored). */
  noteStore: NoteStore;
  /** Encrypted vault (null when storage is unavailable). Flows use it
   *  for WAL putPending/deletePending around tx submission. */
  vault: NoteVault | null;
  /** null = vault healthy; otherwise why persistence is unavailable
   *  (UI: warning banner + deposits gated behind explicit confirm). */
  storageUnavailable: VaultUnavailableReason | null;
  /** Cross-tab role; "reader" tabs must not submit txs. */
  tabRole: TabRole;
  /** Background WAL-reconcile + memo-recovery progress. */
  recovery: RecoveryState;
  isDeriving: boolean;
  error: string | null;
  derive: () => Promise<void>;
  clear: () => void;
};

const SpendingKeyContext = createContext<SpendingKeyContextValue | null>(null);

const determinismMarker = (chainId: number, address: string) =>
  `zenfinance:eoa-determinism-ok:v1:${chainId}:${address.toLowerCase()}`;

export function SpendingKeyProvider({ children }: { children: ReactNode }) {
  const { address, chainId, signTypedDataAsync } = useWallet();
  const [unlocked, setUnlocked] = useState(false);
  const [secretKey, setSecretKey] = useState<bigint | null>(null);
  const [spendingPubkey, setSpendingPubkey] = useState<bigint | null>(null);
  const [viewingKey, setViewingKey] = useState<Uint8Array | null>(null);
  const [storageUnavailable, setStorageUnavailable] =
    useState<VaultUnavailableReason | null>(null);
  const [tabRole, setTabRole] = useState<TabRole>({ role: "writer", exclusive: false });
  const [recovery, setRecovery] = useState<RecoveryState>({ status: "idle" });
  const [isDeriving, setIsDeriving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs so the IMT instances + note store survive re-renders without
  // forcing fresh ones each time. On clear() we drop them all together.
  const entryImtRef = useRef<LocalIMT>(new LocalIMT());
  const supplyImtRef = useRef<LocalIMT>(new LocalIMT());
  const positionImtRef = useRef<LocalIMT>(new LocalIMT());
  const noteStoreRef = useRef<NoteStore>(new NoteStore());
  const vaultRef = useRef<NoteVault | null>(null);
  const tabLockRef = useRef<TabLock | null>(null);

  const runRecovery = useCallback(
    async (keys: { spendingKey: bigint; viewingKey: Uint8Array }) => {
      const vault = vaultRef.current;
      try {
        const { client, privacyEntry, scanFloor } = makeScanClient(chainId);
        const scanner = new RecoveryScanner({
          fetchLogs: makeFetchLogs({ client, privacyEntry }),
          scanFloor,
        });
        const head = await client.getBlockNumber();
        const view = await scanner.syncTo(head, (scannedTo) =>
          setRecovery({ status: "scanning", scannedTo, head }),
        );

        // 1) WAL reconciliation — crash-recover in-flight transactions.
        let walPromoted = 0;
        if (vault) {
          const { records } = await vault.listPending();
          const chain = buildCommitmentIndex(view.depositLeaves);
          for (const verdict of reconcileWal({ records, chain, nowMs: Date.now() })) {
            if (verdict.action === "promote") {
              const indices = new Map(verdict.notes);
              for (const [leaf, preimage] of verdict.record.expectedNotes) {
                const patch = indices.get(leaf.toLowerCase());
                if (patch) {
                  noteStoreRef.current.registerHex(leaf, { ...preimage, leafIdx: patch.leafIdx });
                }
              }
              for (const spent of verdict.record.spendsLeaves) {
                noteStoreRef.current.forget(spent);
              }
              await vault.deletePending(verdict.record.id);
              walPromoted += 1;
            } else if (verdict.action === "drop") {
              await vault.deletePending(verdict.record.id);
            } else if (verdict.action === "conflict") {
              console.warn("WAL conflict — leaving for manual recovery", verdict);
            } // "wait": keep the record for the next reconcile pass
          }
        }

        // 2) Memo recovery — trial-decrypt every on-chain memo locally.
        const { notes } = await recoverNotes({
          view,
          viewingKey: keys.viewingKey,
          spendingKey: keys.spendingKey,
        });
        let recovered = 0;
        for (const note of notes) {
          if (note.spent) {
            noteStoreRef.current.forget(note.leafHex);
            continue;
          }
          if (!noteStoreRef.current.get(note.leafHex)) {
            noteStoreRef.current.registerHex(note.leafHex, note.preimage);
            recovered += 1;
          }
        }
        setRecovery({ status: "done", recovered, walPromoted });
      } catch (err) {
        // Scan is resumable, but surface the interruption loudly rather
        // than showing a silently-partial balance.
        const message = err instanceof Error ? err.message : String(err);
        setRecovery({ status: "error", message });
      }
    },
    [chainId],
  );

  const derive = useCallback(async () => {
    if (!address) {
      setError("Connect your wallet first.");
      return;
    }
    setIsDeriving(true);
    setError(null);
    try {
      const privacyEntry = getChainConfig(chainId).contracts.privacyEntry;
      if (!privacyEntry) {
        throw new Error(
          `PrivacyEntry address not configured for chainId ${chainId} — check NEXT_PUBLIC_* env`,
        );
      }
      const bind = { address, chainId, privacyEntry };
      const typedData = keyDerivationTypedData(bind);
      const sig1 = await signTypedDataAsync(typedData);

      // First-setup EOA determinism check (D19=12A): one extra signature,
      // then never again for this {chainId, address}.
      const marker = determinismMarker(chainId, address);
      if (typeof localStorage !== "undefined" && !localStorage.getItem(marker)) {
        const sig2 = await signTypedDataAsync(typedData);
        const [a, b] = [canonicalRS(sig1), canonicalRS(sig2)];
        const same = a.length === b.length && a.every((v, i) => v === b[i]);
        if (!same) {
          throw new Error(
            "Your wallet produced two different signatures for the same message. " +
              "Recovery of private balances would be impossible with this signer " +
              "(smart-contract and MPC wallets are not supported yet). " +
              "Deposits are blocked to protect your funds.",
          );
        }
        localStorage.setItem(marker, "1");
      }

      const keys = sessionKeysFromSignature(sig1, bind);
      setSecretKey(keys.spendingKey);
      setSpendingPubkey(spendingPubkeyOf(keys.spendingKey));
      setViewingKey(keys.viewingKey);

      // Encrypted persistence: hydrate FIRST, then attach the mirror so
      // hydration doesn't echo rows back into the vault.
      const opened = await NoteVault.open({ storageKey: keys.storageKey, chainId, address });
      if (opened.ok) {
        vaultRef.current = opened.vault;
        setStorageUnavailable(null);
        const { notes, corruptRows } = await opened.vault.loadAll();
        for (const [leaf, preimage] of notes) {
          noteStoreRef.current.registerHex(leaf, preimage);
        }
        if (corruptRows > 0) {
          console.warn(`note vault: ${corruptRows} rows failed decryption (stale key?)`);
        }
        noteStoreRef.current.attachMirror({
          onRegister: (leafHex, preimage) => void opened.vault.put(leafHex, preimage).catch(console.error),
          onForget: (leafHex) => void opened.vault.delete(leafHex).catch(console.error),
        });
      } else {
        vaultRef.current = null;
        setStorageUnavailable(opened.reason);
      }

      // Cross-tab exclusivity; readers watch for writer handoff.
      const lock = await TabLock.acquire({ chainId, address });
      tabLockRef.current = lock;
      setTabRole(lock.role);
      lock.onChange(setTabRole);

      setUnlocked(true);

      // Writer runs WAL reconcile + memo recovery in the background.
      if (lock.role.role === "writer") {
        void runRecovery({ spendingKey: keys.spendingKey, viewingKey: keys.viewingKey });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsDeriving(false);
    }
  }, [address, chainId, signTypedDataAsync, runRecovery]);

  const clear = useCallback(() => {
    setUnlocked(false);
    setSecretKey(null);
    setSpendingPubkey(null);
    setViewingKey(null);
    setError(null);
    setRecovery({ status: "idle" });
    setStorageUnavailable(null);
    noteStoreRef.current.detachMirror();
    tabLockRef.current?.release();
    tabLockRef.current = null;
    vaultRef.current?.close();
    vaultRef.current = null;
    entryImtRef.current = new LocalIMT();
    supplyImtRef.current = new LocalIMT();
    positionImtRef.current = new LocalIMT();
    noteStoreRef.current = new NoteStore();
  }, []);

  const value = useMemo(
    () => ({
      unlocked,
      secretKey,
      spendingPubkey,
      viewingKey,
      entryImt: entryImtRef.current,
      supplyImt: supplyImtRef.current,
      positionImt: positionImtRef.current,
      noteStore: noteStoreRef.current,
      vault: vaultRef.current,
      storageUnavailable,
      tabRole,
      recovery,
      isDeriving,
      error,
      derive,
      clear,
    }),
    [
      unlocked,
      secretKey,
      spendingPubkey,
      viewingKey,
      storageUnavailable,
      tabRole,
      recovery,
      isDeriving,
      error,
      derive,
      clear,
    ],
  );

  return <SpendingKeyContext.Provider value={value}>{children}</SpendingKeyContext.Provider>;
}

export function useSpendingKey(): SpendingKeyContextValue {
  const ctx = useContext(SpendingKeyContext);
  if (!ctx) {
    throw new Error("useSpendingKey must be used inside <SpendingKeyProvider>");
  }
  return ctx;
}
