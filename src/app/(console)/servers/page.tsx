import { TopBar } from "@/components/layout/top-bar";
import { listServerCapacity } from "@/lib/servers/queries";
import { ServersClient } from "./servers-client";

export default async function ServersPage() {
  const servers = await listServerCapacity();

  return (
    <>
      <TopBar title="Servers" />
      <main className="p-5">
        <ServersClient servers={servers} />
      </main>
    </>
  );
}
