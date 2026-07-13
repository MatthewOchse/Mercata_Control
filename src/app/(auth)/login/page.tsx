import { MercataMark } from "@/components/brand/mercata-mark";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : "/";

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 flex flex-col items-center gap-3">
        <MercataMark size={48} priority />
        <h1 className="font-display text-2xl font-semibold tracking-tight text-primary">
          Mercata Control
        </h1>
        <p className="text-[13px] text-muted">Operator sign-in</p>
      </div>
      <LoginForm next={next} />
    </div>
  );
}
