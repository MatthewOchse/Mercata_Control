"use client";

import { useEffect, useState } from "react";
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
  { href: "/revenue", label: "Revenue" },
  { href: "/plans", label: "Plans" },
  { href: "/files", label: "Files" },
  { href: "/servers", label: "Servers" },
  { href: "/health", label: "Health" },
  { href: "/help", label: "Help" },
  { href: "/settings", label: "Settings" },
] as const;

export function ConsoleShell({
  operatorEmail,
  children,
}: {
  operatorEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="flex min-h-full min-w-0 overflow-x-clip">
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-primary-dark/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(16.5rem,85vw)] flex-col bg-primary-dark text-white transition-transform duration-200 md:static md:z-auto md:w-52 md:shrink-0 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-4">
          <MercataMark size={26} priority />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-wide">
              Mercata
            </div>
            <div className="truncate text-[11px] text-white/55">Control</div>
          </div>
          <button
            type="button"
            className="ml-auto rounded-[4px] px-2 py-1 text-[12px] text-white/70 hover:bg-white/10 md:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            Close
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
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

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex h-11 items-center gap-2 border-b border-border bg-surface px-3 md:hidden">
          <button
            type="button"
            className="rounded-[4px] border border-border px-2.5 py-1 text-[12px] font-medium text-foreground"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            Menu
          </button>
          <span className="truncate text-[13px] font-semibold text-foreground">
            Mercata Control
          </span>
        </div>
        <div className="min-w-0 flex-1 overflow-x-clip">{children}</div>
      </div>
    </div>
  );
}
