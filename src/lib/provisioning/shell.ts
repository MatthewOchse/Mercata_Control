import { spawn } from "node:child_process";
import type { SecretRedactor } from "@/lib/provisioning/redact";

export type ShellResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/**
 * Run a command, capture output, redact secrets before returning text for logs.
 * Does not stream raw secrets to the caller — always go through redactor.
 */
export async function runShell(opts: {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  redactor: SecretRedactor;
  /** Soft timeout ms (SIGTERM then SIGKILL). 0 = none. */
  timeoutMs?: number;
}): Promise<ShellResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn(opts.cmd, opts.args, {
      cwd: opts.cwd,
      env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
          }, opts.timeoutMs)
        : null;

    child.stdout.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
    });
    child.stderr.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        code: code ?? 1,
        stdout: opts.redactor.redact(stdout),
        stderr: opts.redactor.redact(stderr),
      });
    });
  });
}

/** Safe argv summary for logs — secret flags already redacted by redactor. */
export function formatCmd(cmd: string, args: string[], redactor: SecretRedactor): string {
  return redactor.redact(`$ ${cmd} ${args.join(" ")}`);
}
