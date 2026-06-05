import { BigInt } from "@graphprotocol/graph-ts";
import { Deposited, Covered } from "../../generated/InsuranceFund/InsuranceFund";
import { InsuranceFundBalance } from "../../generated/schema";

function getOrCreate(token: string): InsuranceFundBalance {
  let b = InsuranceFundBalance.load(token);
  if (b == null) {
    b = new InsuranceFundBalance(token);
    b.balance = BigInt.zero();
    b.totalReceived = BigInt.zero();
    b.totalPaid = BigInt.zero();
  }
  return b;
}

export function handleDeposited(event: Deposited): void {
  const b = getOrCreate(event.params.token.toHexString());
  b.balance = b.balance.plus(event.params.amount);
  b.totalReceived = b.totalReceived.plus(event.params.amount);
  b.save();
}

export function handleCovered(event: Covered): void {
  const b = getOrCreate(event.params.token.toHexString());
  if (b.balance.ge(event.params.amount)) {
    b.balance = b.balance.minus(event.params.amount);
  } else {
    b.balance = BigInt.zero();
  }
  b.totalPaid = b.totalPaid.plus(event.params.amount);
  b.save();
}
