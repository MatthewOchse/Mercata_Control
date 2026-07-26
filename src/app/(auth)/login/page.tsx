import { redirect } from "next/navigation";
import { MercataMark } from "@/components/brand/mercata-mark";
import { getCurrentOperator } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next =
    params.next &&
    params.next.startsWith("/") &&
    !params.next.startsWith("/login")
      ? params.next
      : "/";

  const operator = await getCurrentOperator();
  if (operator) {
    redirect(next);
  }

  return (
    <div className="flex min-h-full w-full max-w-[100vw] flex-col items-center justify-center overflow-x-clip bg-background px-4 pt-16 pb-8">
      <div className="mb-8 flex w-full max-w-sm flex-col items-center gap-3">
        <MercataMark size={48} priority />
        <h1 className="font-display text-center text-2xl font-semibold tracking-tight text-primary">
          Mercata Control
        </h1>
        <p className="text-[13px] text-muted">Operator sign-in</p>
      </div>
      <LoginForm next={next} />
    </div>
  );
}
