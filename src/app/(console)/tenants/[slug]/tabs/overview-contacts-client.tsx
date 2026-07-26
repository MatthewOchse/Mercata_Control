"use client";

import { useActionState, useState } from "react";
import {
  addContactAction,
  updateContactAction,
  type ActionState,
} from "@/app/(console)/tenants/actions";
import type { ContactRecord } from "@/lib/tenants/types";

const empty: ActionState = {};

export function OverviewContactsClient({
  slug,
  contacts,
}: {
  slug: string;
  contacts: ContactRecord[];
}) {
  return (
    <section className="rounded-[4px] border border-border bg-surface p-4">
      <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">
        Contacts &amp; email routing
      </h3>
      <p className="mb-3 text-[11px] text-muted">
        Invoices and analytics digests can go to different emails — tick one or
        both per contact. Multiple addresses are fine.
      </p>
      {contacts.length === 0 ? (
        <p className="text-[13px] text-muted">No contacts</p>
      ) : (
        <div className="space-y-4">
          {contacts.map((c) => (
            <ContactEditForm key={c.id} slug={slug} contact={c} />
          ))}
        </div>
      )}
      <AddContactForm slug={slug} />
    </section>
  );
}

function ContactEditForm({
  slug,
  contact,
}: {
  slug: string;
  contact: ContactRecord;
}) {
  const [state, action, pending] = useActionState(updateContactAction, empty);

  return (
    <form
      action={action}
      className="space-y-2 border-b border-border pb-4 last:border-0 last:pb-0"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="contact_id" value={contact.id} />
      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        {contact.role}
        {contact.is_primary ? " · primary" : ""}
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Name</span>
          <input
            name="name"
            required
            defaultValue={contact.name}
            className="h-8 w-44 rounded-[4px] border border-border px-2 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Email</span>
          <input
            name="email"
            type="email"
            required
            defaultValue={contact.email}
            className="h-8 w-52 rounded-[4px] border border-border px-2 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">Phone</span>
          <input
            name="phone"
            defaultValue={contact.phone ?? ""}
            className="h-8 w-36 rounded-[4px] border border-border px-2 font-mono text-[12px]"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[12px]">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            name="receive_invoices"
            defaultChecked={Boolean(contact.receive_invoices)}
          />
          Invoices
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            name="receive_digests"
            defaultChecked={Boolean(contact.receive_digests)}
          />
          Analytics digests
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-8 rounded-[4px] border border-border px-3 text-[12px] font-semibold hover:border-primary-light hover:bg-primary hover:text-white disabled:opacity-60"
        >
          Save
        </button>
      </div>
      {state.error ? (
        <p className="text-[12px] text-status-error">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="text-[12px] text-status-ok">{state.message}</p>
      ) : null}
    </form>
  );
}

function AddContactForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(addContactAction, empty);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 text-[12px] font-semibold text-accent-strong hover:underline"
      >
        + Add email recipient
      </button>
    );
  }

  return (
    <form action={action} className="mt-4 space-y-2 rounded-[4px] border border-dashed border-border p-3">
      <input type="hidden" name="slug" value={slug} />
      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        New recipient
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          name="name"
          placeholder="Name"
          className="h-8 w-40 rounded-[4px] border border-border px-2 text-[13px]"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="email@example.com"
          className="h-8 w-52 rounded-[4px] border border-border px-2 text-[13px]"
        />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[12px]">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" name="receive_invoices" />
          Invoices
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" name="receive_digests" defaultChecked />
          Analytics digests
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-8 rounded-[4px] bg-primary px-3 text-[12px] font-semibold text-white disabled:opacity-60"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-8 text-[12px] text-muted"
        >
          Cancel
        </button>
      </div>
      {state.error ? (
        <p className="text-[12px] text-status-error">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="text-[12px] text-status-ok">{state.message}</p>
      ) : null}
    </form>
  );
}
