"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Entry" },
  { href: "/supply", label: "Supply" },
  { href: "/borrow", label: "Borrow" },
  { href: "/repay", label: "Repay" },
  { href: "/collateral", label: "Collateral" },
] as const;

export function NavTabs() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-white/10 bg-black/20">
      <div className="mx-auto flex max-w-6xl items-center gap-1 px-6">
        {TABS.map((t) => {
          const isActive = pathname === t.href || (t.href !== "/" && pathname?.startsWith(t.href));
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`-mb-px border-b-2 px-3 py-3 text-sm transition-colors ${
                isActive
                  ? "border-emerald-400 text-white"
                  : "border-transparent text-white/50 hover:text-white/80"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
