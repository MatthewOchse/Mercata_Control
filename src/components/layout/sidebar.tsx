"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MercataMark } from "@/components/brand/mercata-mark";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/tenants", label: "Tenants" },
  { href: "/invoices", label: "Invoices" },
  { href: "/billing/run", label: "Billing" },
  { href: "/payments", label: "Payments" },
  { href: "/health", label: "Health" },
  { href: "/settings", label: "Settings" },
] as const;

export function Sidebar({ operatorEmail }: { operatorEmail: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-52 shrink-0 flex-col bg-primary-dark text-white">
      <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-4">
        <MercataMark size={26} priority />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold tracking-wide">
            Mercata
          </div>
          <div className="truncate text-[11px] text-white/55">Control</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative rounded-[4px] px-3 py-2 text-[13px] transition-colors",
                active
                  ? "bg-white/8 font-medium text-white"
                  : "text-white/70 hover:bg-white/5 hover:text-white",
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-r bg-accent"
                />
              ) : null}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        <div className="truncate font-mono text-[10px] text-white/45">
          {operatorEmail}
        </div>
      </div>
    </aside>
  );
}
