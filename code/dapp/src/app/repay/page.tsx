import { LendingForm } from "@/components/LendingForm";

export default function RepayPage() {
  return (
    <>
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Repay</h1>
        <p className="mt-1 max-w-xl text-sm text-white/60">
          Repay debt for the named asset. Repay-in-full burns the debt note;
          partial repays generate a new note with the remaining balance.
        </p>
      </section>
      <LendingForm kind="repay" />
    </>
  );
}
