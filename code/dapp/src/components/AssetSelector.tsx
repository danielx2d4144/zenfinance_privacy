"use client";

export type AssetSymbol = "USDC" | "cbBTC" | "WETH" | "ZEN";

export const ASSET_DECIMALS: Record<AssetSymbol, number> = {
  USDC: 6,
  cbBTC: 8,
  WETH: 18,
  ZEN: 18,
};

export const ASSETS: AssetSymbol[] = ["USDC", "cbBTC", "WETH", "ZEN"];

export function AssetSelector({
  value,
  onChange,
  disabled,
  label = "Asset",
}: {
  value: AssetSymbol;
  onChange: (next: AssetSymbol) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-white/60">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as AssetSymbol)}
        disabled={disabled}
        className="mt-2 w-40 rounded-md border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm focus:border-emerald-400 focus:outline-none disabled:opacity-50"
      >
        {ASSETS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </label>
  );
}
