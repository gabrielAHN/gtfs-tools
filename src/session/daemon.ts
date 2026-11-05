import { execFile, spawn } from "node:child_process";
import { readFile, readdir, readlink } from "node:fs/promises";
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

const runOnce = (file: string, args: string[]) =>
  new Promise<{ code: number | string | null; stdout: string }>((resolve) => {
    execFile(file, args, { timeout: 5000, encoding: "utf8" }, (error, stdout) => {
      const code = error ? ((error as NodeJS.ErrnoException).code ?? 1) : 0;
      resolve({ code: code as number | string | null, stdout: stdout ?? "" });
    });
  });

// Runs a system tool from PATH, or from its usual locations when PATH lacks them (macOS keeps lsof in
// /usr/sbin).
const run = async (tool: "ps" | "lsof", args: string[]) => {
  let result = await runOnce(tool, args);
  for (const dir of ["/usr/sbin", "/usr/bin", "/bin", "/sbin"]) {
    if (result.code !== "ENOENT") break;
    result = await runOnce(path.join(dir, tool), args);
  }
  return result;
};

// The command line of a process, or null when it can't be read (no /proc and no ps).
export async function processCommandLine(pid: number): Promise<string | null> {
  const proc = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => null);
  if (proc) return proc.split("\0").filter(Boolean).join(" ");
  const ps = await run("ps", ["-o", "command=", "-p", String(pid)]);
  return ps.code === 0 && ps.stdout.trim() ? ps.stdout.trim() : null;
}

// The inodes of TCP sockets listening on `port`, from /proc/net/tcp{,6} (Linux), or null without /proc.
async function procListeningInodes(port: number): Promise<Set<string> | null> {
  let found: Set<string> | null = null;
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const text = await readFile(table, "utf8").catch(() => null);
    if (text === null) continue;
    found ??= new Set();
    for (const line of text.split("\n").slice(1)) {
      // sl local_address rem_address st tx_queue:rx_queue tr:tm->when retrnsmt uid timeout inode
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10 || fields[3] !== "0A") continue; // 0A = LISTEN
      if (Number.parseInt(fields[1].split(":").at(-1) ?? "", 16) === port) found.add(fields[9]);
    }
  }
  return found;
}

// Whether `pid` itself listens on `port`: through /proc on Linux (its open socket inodes), else lsof (macOS,
// BSD). When neither can tell, the answer is no, so an unverifiable process is never signalled.
async function listensOn(pid: number, port: number): Promise<boolean> {
  const inodes = await procListeningInodes(port);
  if (inodes) {
    const fds = await readdir(`/proc/${pid}/fd`).catch(() => [] as string[]);
    for (const fd of fds) {
      const link = await readlink(`/proc/${pid}/fd/${fd}`).catch(() => "");
      const socket = /^socket:\[(\d+)\]$/.exec(link);
      if (socket && inodes.has(socket[1])) return true;
    }
    return false;
  }
  const lsof = await run("lsof", ["-nP", "-a", "-p", String(pid), `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  return lsof.code === 0 && lsof.stdout.split(/\s+/).includes(String(pid));
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

// An exited process that its parent has not reaped yet (a zombie) still answers kill(pid, 0). That happens
// when the parent never reaps, e.g. a container whose PID 1 is a plain shell.
const isZombie = async (pid: number) => {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => null);
  if (stat !== null) return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z");
  const ps = await run("ps", ["-o", "stat=", "-p", String(pid)]);
  return ps.code === 0 && ps.stdout.trim().startsWith("Z");
};

const exited = async (pid: number) => !alive(pid) || (await isZombie(pid));

const waitForExit = async (pid: number, ms: number) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await exited(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return exited(pid);
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
