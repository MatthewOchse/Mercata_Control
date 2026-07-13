"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initial: LoginState = {};

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-3">
      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px] outline-none focus:border-accent-strong"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
          Password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-9 rounded-[4px] border border-border bg-surface px-3 text-[13px] outline-none focus:border-accent-strong"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
          Authenticator code
        </span>
        <input
          name="totp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          className="h-9 rounded-[4px] border border-border bg-surface px-3 font-mono text-[13px] outline-none focus:border-accent-strong"
        />
      </label>

      {state.error ? (
        <p className="rounded-[4px] border border-status-error/30 bg-status-error/8 px-3 py-2 text-[12px] text-status-error">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 h-9 rounded-[4px] bg-accent-strong text-[13px] font-semibold text-white hover:opacity-95 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
