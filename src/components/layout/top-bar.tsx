import { logoutAction } from "@/app/(auth)/login/actions";

export function TopBar({ title }: { title: string }) {
  return (
    <header className="flex h-11 min-w-0 items-center justify-between gap-3 border-b border-border bg-surface px-3 sm:px-5">
      <h1 className="min-w-0 truncate text-[15px] font-semibold text-foreground">
        {title}
      </h1>
      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-[4px] border border-border px-2.5 py-1 text-[12px] text-muted hover:border-primary-light hover:text-foreground"
        >
          Sign out
        </button>
      </form>
    </header>
  );
}
