"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth/server";
import { upsertServer } from "@/lib/servers/service";

export type ServerActionState = { error?: string; message?: string };

export async function upsertServerAction(
  _prev: ServerActionState,
  formData: FormData,
): Promise<ServerActionState> {
  const operator = await requireOperator();
  try {
    const name = String(formData.get("name") ?? "");
    await upsertServer(
      {
        name,
        label: String(formData.get("label") ?? "").trim() || null,
        capacity: Number(formData.get("capacity")),
        notes: String(formData.get("notes") ?? "").trim() || null,
        active: formData.get("active") === "on",
      },
      operator.email,
    );
    revalidatePath("/servers");
    revalidatePath("/");
    return { message: `${name.trim().toLowerCase()} saved` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Save failed" };
  }
}
