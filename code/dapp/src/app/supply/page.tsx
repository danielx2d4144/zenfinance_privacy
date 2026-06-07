import { LendingForm } from "@/components/LendingForm";

export default function SupplyPage() {
  return (
    <>
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Supply &amp; withdraw</h1>
        <p className="mt-1 max-w-xl text-sm text-white/60">
          Earn yield by lending PrivacyEntry balance into the supply pool. All flows
          stay private — the proof commits to your supply note without revealing it.
        </p>
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LendingForm kind="supply" />
        <LendingForm kind="withdraw_supply" />
      </div>
    </>
  );
}
