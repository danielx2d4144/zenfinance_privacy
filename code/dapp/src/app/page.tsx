import { DepositForm } from "@/components/DepositForm";
import { PrivateBalancePanel } from "@/components/PrivateBalancePanel";
import { TopBar } from "@/components/TopBar";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-950 text-zinc-100">
      <TopBar />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">PrivacyEntry</h1>
          <p className="mt-1 max-w-xl text-sm text-white/60">
            The only public surface of the protocol. Deposits and withdrawals here are
            visible on-chain; everything past PrivacyEntry — supply, borrow, repay — is
            private and lives behind ZK proofs.
          </p>
        </section>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DepositForm />
          <PrivateBalancePanel />
        </div>
      </main>
    </div>
  );
}
