import { Sidebar } from "@/components/layout/sidebar";
import { requireOperator } from "@/lib/auth/server";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const operator = await requireOperator();

  return (
    <div className="flex min-h-full">
      <Sidebar operatorEmail={operator.email} />
      <div className="flex min-w-0 flex-1 flex-col bg-background">{children}</div>
    </div>
  );
}
