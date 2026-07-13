import { logoutAction } from "@/app/(auth)/login/actions";

export function TopBar({ title }: { title: string }) {
  return (
    <header className="flex h-11 items-center justify-between border-b border-border bg-surface px-5">
      <h1 className="text-[15px] font-semibold text-foreground">{title}</h1>
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
