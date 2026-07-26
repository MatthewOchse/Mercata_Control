import type { RowDataPacket } from "mysql2/promise";
import { writeAuditLog } from "@/lib/db/audit";
import { withTransaction } from "@/lib/db/pool";

export type ServerInput = {
  name: string;
  label: string | null;
  capacity: number;
  notes: string | null;
  active: boolean;
};

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export async function upsertServer(
  input: ServerInput,
  actor: string,
): Promise<void> {
  const name = input.name.trim().toLowerCase();
  if (!NAME_RE.test(name)) {
    throw new Error(
      "Server name must be lowercase letters, digits, dot, dash or underscore",
    );
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    throw new Error("Capacity must be at least 1 tenant");
  }

  await withTransaction(async (conn) => {
    type Before = RowDataPacket & {
      label: string | null;
      capacity: number;
      notes: string | null;
      active: number;
    };
    const [rows] = await conn.execute<Before[]>(
      `SELECT label, capacity, notes, active FROM servers WHERE name = ? LIMIT 1`,
      [name],
    );
    const before = rows[0] ?? null;

    await conn.execute(
      `INSERT INTO servers (name, label, capacity, notes, active)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         capacity = VALUES(capacity),
         notes = VALUES(notes),
         active = VALUES(active)`,
      [
        name,
        input.label?.trim() || null,
        input.capacity,
        input.notes?.trim() || null,
        input.active ? 1 : 0,
      ],
    );

    await writeAuditLog(conn, {
      actor,
      action: before ? "server.updated" : "server.registered",
      entityType: "server",
      entityId: name,
      before: before
        ? {
            label: before.label,
            capacity: Number(before.capacity),
            notes: before.notes,
            active: Boolean(before.active),
          }
        : undefined,
      after: {
        label: input.label?.trim() || null,
        capacity: input.capacity,
        notes: input.notes?.trim() || null,
        active: input.active,
      },
    });
  });
}
