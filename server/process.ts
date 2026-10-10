import { spawn, type ChildProcess } from "node:child_process";
export function stopProcess(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    killer.on("error", () => child.kill());
  } else child.kill("SIGTERM");
}
export async function runProcess(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    signal?: AbortSignal;
    timeout?: number;
    input?: string;
    onLine?: (line: string) => void;
    env?: NodeJS.ProcessEnv;
    maxOutput?: number;
  } = {},
) {
  return new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve, reject) => {
      if (options.signal?.aborted) return reject(new Error("Task stopped."));
      const child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "",
        pending = "",
        settled = false;
      const finish = (e?: Error, code = 0) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        if (e) reject(e);
        else resolve({ stdout, stderr, code });
      };
      const abort = () => {
        stopProcess(child);
        finish(new Error("Task stopped."));
      };
      const timer = setTimeout(() => {
        stopProcess(child);
        finish(
          new Error("Process timed out. Review its outputs before retrying."),
        );
      }, options.timeout || 120000);
      options.signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (buf) => {
        const data = buf.toString();
        stdout += data;
        pending += data;
        let pos;
        while ((pos = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, pos);
          pending = pending.slice(pos + 1);
          try {
            options.onLine?.(line);
          } catch (e) {
            stopProcess(child);
            finish(e as Error);
            return;
          }
        }
        if (stdout.length > (options.maxOutput || 2_000_000)) {
          stopProcess(child);
          finish(new Error("Process output exceeded its limit."));
        }
      });
      child.stderr.on("data", (b) => {
        stderr = (stderr + b.toString()).slice(-16000);
      });
      child.on("error", (e) => finish(e));
      child.on("close", (code) => {
        if (pending)
          try {
            options.onLine?.(pending);
          } catch (e) {
            finish(e as Error);
            return;
          }
        finish(undefined, code ?? 1);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(options.input || "");
    },
  );
}
