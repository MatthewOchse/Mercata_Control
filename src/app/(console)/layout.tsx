import { ConsoleShell } from "@/components/layout/console-shell";
import { requireOperator } from "@/lib/auth/server";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const operator = await requireOperator();

  return (
    <ConsoleShell operatorEmail={operator.email}>{children}</ConsoleShell>
  );
}
