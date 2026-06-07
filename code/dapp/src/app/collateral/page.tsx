import { LendingForm } from "@/components/LendingForm";

export default function CollateralPage() {
  return (
    <>
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Collateral</h1>
        <p className="mt-1 max-w-xl text-sm text-white/60">
          Move balances in and out of the position pool. Withdrawals respect the HF
          floor; the contract reverts any tx that would dip the position below it.
        </p>
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LendingForm kind="deposit_collateral" />
        <LendingForm kind="withdraw_collateral" />
      </div>
    </>
  );
}
