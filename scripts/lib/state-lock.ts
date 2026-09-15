import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * AN EXCLUSIVE LOCK OVER A KEEPER STATE FILE.
 *
 * `scripts/keeper.ts` reads `.keeper-state.json` once at start and writes it back after
 * every step. Two keeper processes pointed at the same network read and write that file
 * with no coordination: both can act on the same `nextRound`, the second hits Aqua's
 * duplicate-strategy revert on a round the first already shipped, and whichever process
 * writes last silently overwrites the other's progress. This makes that a refusal to
 * start instead of a silent race.
 *
 * THE LOCK FILE IS `<state file>.lock`, created with the `wx` flag -- "create, fail if it
 * already exists" -- which is atomic on both Windows and POSIX (it is a single filesystem
 * syscall, `O_CREAT | O_EXCL` under the hood on POSIX and the equivalent on Windows via
 * libuv). That atomicity is what makes this safe against two processes starting at the
 * same instant: at most one `openSync(..., "wx")` can win.
 *
 * A STALE LOCK -- one left behind by a process that crashed or was killed without a
 * chance to clean up -- is detected by asking the OS whether the PID recorded inside it
 * is still alive (`process.kill(pid, 0)`, which sends no signal and only probes for
 * existence; this works the same way on Windows, where libuv emulates it with
 * `OpenProcess`). A dead PID means the lock is safe to steal; a live one, or a PID this
 * process has no permission to signal (still alive, just not ours to inspect), means
 * someone else genuinely holds it.
 */

export interface StateLock {
  /** Idempotent: safe to call more than once, and safe to call after the process's own
   *  `exit` handler has already released it. */
  release(): void;
}

function toPath(stateFile: string | URL): string {
  return typeof stateFile === "string" ? stateFile : fileURLToPath(stateFile);
}

/** True if `pid` names a process that is still running (or one we cannot signal, which
 *  on every platform means it exists but is not ours). False only when the OS is sure
 *  the process is gone. */
function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    if (e && e.code === "ESRCH") return false; // definitively gone
    // EPERM (exists, we may not signal it) or anything else unexpected: do not risk
    // stealing a lock a live process might actually hold.
    return true;
  }
}

/** Whoever's PID is recorded in the lock file at `lockPath`, or null if the file is
 *  missing, unreadable, or does not carry a parseable PID -- which is treated the same
 *  as a stale lock, since there is nothing to prove the holder is still alive. */
function readLockPid(lockPath: string): number | null {
  try {
    const raw = readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    const pid = Number(parsed.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writeLockPid(fd: number): void {
  writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
}

/**
 * Acquire the lock, or throw with a message naming the lock file and the PID that holds
 * it. Call this before the state file is ever read, and hold the returned handle for the
 * lifetime of the process; call `.release()` when done (normal exit and SIGINT/SIGTERM
 * are also covered automatically -- see below).
 */
export function acquireLock(stateFile: string | URL): StateLock {
  const statePath = toPath(stateFile);
  const lockPath = `${statePath}.lock`;

  const tryCreate = (): number | null => {
    try {
      return openSync(lockPath, "wx");
    } catch (e: any) {
      if (e && e.code === "EEXIST") return null;
      throw e;
    }
  };

  let fd = tryCreate();
  if (fd === null) {
    const holderPid = readLockPid(lockPath);
    if (holderPid !== null && processAlive(holderPid)) {
      throw new Error(
        `${lockPath} is already held by pid ${holderPid}, which is still running. ` +
        `Only one keeper may run against ${statePath} at a time. ` +
        `If pid ${holderPid} is not actually a keeper (or is definitely dead), delete ${lockPath} and retry.`,
      );
    }
    // Stale (holder is gone) or unreadable (nothing proves a live holder): safe to steal.
    console.error(
      holderPid === null
        ? `  ${lockPath} exists but does not name a live process; treating it as stale and taking it over.`
        : `  ${lockPath} was held by pid ${holderPid}, which is no longer running; taking it over.`,
    );
    try {
      unlinkSync(lockPath);
    } catch {
      // Already gone -- fine, tryCreate below is what actually matters.
    }
    fd = tryCreate();
    if (fd === null) {
      // Lost a race with another process doing the exact same takeover at the same
      // instant. Rare, and not worth retrying in a loop: surface it and let the operator
      // re-run.
      throw new Error(
        `${lockPath} was stolen by another process during takeover. Another keeper just started against ${statePath}; retry if this one should have won.`,
      );
    }
  }

  writeLockPid(fd);
  closeSync(fd);

  let released = false;
  const doRelease = () => {
    if (released) return;
    released = true;
    // Only remove the file if it still names US. If it was stolen from us (this process
    // hung past a stale-lock timeout some *other* tool enforces, say) we must not delete
    // over whatever a third process wrote.
    const holderPid = readLockPid(lockPath);
    if (holderPid === null || holderPid === process.pid) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Already gone -- fine.
      }
    }
  };

  // `exit` fires for a normal return from main(), for `process.exitCode` being set and
  // the event loop draining, and after a SIGINT/SIGTERM whose handler does not itself
  // call process.exit() -- which is exactly what scripts/keeper.ts does: it sets a `stop`
  // flag and lets the round in flight finish, then returns normally. Releasing here,
  // rather than directly inside a SIGINT/SIGTERM handler, is deliberate: it fires only
  // once the process is actually about to end, not the instant Ctrl-C is pressed while
  // keeper.ts is still finishing a round and still needs the state file.
  process.on("exit", doRelease);

  return {
    release: () => {
      doRelease();
      process.off("exit", doRelease);
    },
  };
}
