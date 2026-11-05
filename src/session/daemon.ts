import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  readDaemonMetadata,
  removeDaemonMetadata,
  removeDaemonMetadataFor,
  removeAllSessions,
  removeSession,
  type DaemonMetadata,
} from "./metadata.js";

export async function isDaemonRunning(): Promise<DaemonMetadata | null> {
  const meta = await readDaemonMetadata();
  if (!meta) return null;

  try {
    process.kill(meta.pid, 0);
    return meta;
  } catch {
    await removeDaemonMetadata();
    return null;
  }
}

export async function startDaemon(cliArgs: string[]): Promise<void> {
  const cliEntry = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "index.js"
  );

  const child = spawn(process.execPath, [cliEntry, "__daemon__", ...cliArgs], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GTFS_VIZ_DAEMON: "1" },
  });

  // Read startup info from child stdout (first line is JSON with port/url)
  const startupInfo = await new Promise<string>((resolve, reject) => {
    let data = "";
    const timeout = setTimeout(() => {
      child.stdout?.removeAllListeners();
      resolve(data);
    }, 5000);

    child.stdout?.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
      if (data.includes("\n")) {
        clearTimeout(timeout);
        child.stdout?.removeAllListeners();
        resolve(data.split("\n")[0]);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  child.unref();

  if (startupInfo) {
    process.stdout.write(startupInfo + "\n");
  }
}

export async function stopDaemon(): Promise<boolean> {
  const meta = await readDaemonMetadata();
  if (!meta) {
    await removeAllSessions().catch(() => {});
    return false;
  }

  try {
    process.kill(meta.pid, "SIGTERM");
    await removeSession(meta.sessionId).catch(() => {});
    await removeAllSessions().catch(() => {});
    await removeDaemonMetadata();
    return true;
  } catch {
    await removeSession(meta.sessionId).catch(() => {});
    await removeAllSessions().catch(() => {});
    await removeDaemonMetadata();
    return false;
  }
}

// --- Replacing a daemon left running by another CLI version or package --------------------------------------

const run = (file: string, args: string[]) =>
  new Promise<{ code: number | string | null; stdout: string }>((resolve) => {
    execFile(file, args, { timeout: 5000, encoding: "utf8" }, (error, stdout) => {
      const code = error ? ((error as NodeJS.ErrnoException).code ?? 1) : 0;
      resolve({ code: code as number | string | null, stdout: stdout ?? "" });
    });
  });

// The command line of a process, or null when it can't be read (no /proc and no ps).
export async function processCommandLine(pid: number): Promise<string | null> {
  const proc = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => null);
  if (proc) return proc.split("\0").filter(Boolean).join(" ");
  const ps = await run("ps", ["-o", "command=", "-p", String(pid)]);
  return ps.code === 0 && ps.stdout.trim() ? ps.stdout.trim() : null;
}

// Whether `pid` listens on 127.0.0.1:`port`: lsof when installed, otherwise whether the port answers the
// dashboard API as a gtfs-tools/gtfs-viz daemon does.
async function listensOn(pid: number, port: number): Promise<boolean> {
  const lsof = await run("lsof", ["-nP", "-a", "-p", String(pid), `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (lsof.code === 0) return lsof.stdout.split(/\s+/).includes(String(pid));
  if (lsof.code !== "ENOENT") return false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/__gtfs_viz/api/dataset`, {
      signal: AbortSignal.timeout(2000),
    });
    await response.arrayBuffer().catch(() => undefined);
    return (response.headers.get("content-type") ?? "").includes("json");
  } catch {
    return false;
  }
}

const isDaemonCommand = (commandLine: string | null) =>
  commandLine !== null && /index\.js __daemon__(\s|$)/.test(commandLine);

// Whether the process in daemon.json is really a CLI dashboard daemon: its command line runs
// `<package>/dist/index.js __daemon__` and it listens on the recorded port.
export async function isRecordedDaemon(meta: DaemonMetadata): Promise<boolean> {
  if (!isDaemonCommand(await processCommandLine(meta.pid))) return false;
  return listensOn(meta.pid, meta.port);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const waitForExit = async (pid: number, ms: number) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !alive(pid);
};

export type StaleDaemonOutcome = "stopped" | "killed" | "left-running" | "not-a-daemon";

// Stops the daemon recorded in daemon.json so a new one can start: SIGTERM, then SIGKILL after 3 s. It only
// signals a pid that is verifiably a daemon on the recorded port (a reused pid is left alone) and forgets
// the record either way.
export async function stopStaleDaemon(meta: DaemonMetadata): Promise<StaleDaemonOutcome> {
  let outcome: StaleDaemonOutcome;
  if (!(await isRecordedDaemon(meta))) {
    outcome = "not-a-daemon";
  } else {
    try {
      process.kill(meta.pid, "SIGTERM");
    } catch {}
    if (await waitForExit(meta.pid, 3000)) {
      outcome = "stopped";
    } else if (isDaemonCommand(await processCommandLine(meta.pid))) {
      try {
        process.kill(meta.pid, "SIGKILL");
      } catch {}
      outcome = (await waitForExit(meta.pid, 2000)) ? "killed" : "left-running";
    } else {
      outcome = "left-running";
    }
  }
  await removeSession(meta.sessionId).catch(() => {});
  await removeDaemonMetadataFor(meta.pid).catch(() => {});
  return outcome;
}
