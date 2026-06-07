/**
 * Decimal-string → base-units string. Used everywhere we need to send a
 * uint256-shaped amount over the wire without rounding errors.
 */
export function toUnits(amount: string, decimals: number): string {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return "0";
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");
  return combined === "" ? "0" : combined;
}

export function shortenHex(value: string, head = 8): string {
  if (value.length <= head * 2 + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-head)}`;
}
