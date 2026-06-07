import { LendingForm } from "@/components/LendingForm";

export default function BorrowPage() {
  return (
    <>
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Borrow</h1>
        <p className="mt-1 max-w-xl text-sm text-white/60">
          Borrow against your collateral. The HF floor is enforced inside the proof
          itself; the contract rejects any borrow that would dip below it.
        </p>
      </section>
      <LendingForm kind="borrow" />
    </>
  );
}
