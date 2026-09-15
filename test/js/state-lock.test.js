import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { acquireLock } from "../../scripts/lib/state-lock.ts";

/**
 * scripts/keeper.ts reads and writes a state file with no coordination between two
 * processes pointed at the same one -- see TODO.md, "The keeper can stall if more than
 * one process runs against the same state file." acquireLock() is what makes a second
 * keeper refuse to start instead of racing the first one's reads and writes.
 */

function tempStateFile() {
  const dir = mkdtempSync(join(tmpdir(), "glasshouse-state-lock-"));
  return join(dir, ".keeper-state.json");
}

test("acquiring a free lock creates the lock file, naming this process", () => {
  const statePath = tempStateFile();
  const lock = acquireLock(statePath);
  try {
    assert.ok(existsSync(`${statePath}.lock`));
    const recorded = JSON.parse(readFileSync(`${statePath}.lock`, "utf8"));
    assert.equal(recorded.pid, process.pid);
  } finally {
    lock.release();
  }
});

test("release removes the lock file", () => {
  const statePath = tempStateFile();
  const lock = acquireLock(statePath);
  lock.release();
  assert.equal(existsSync(`${statePath}.lock`), false);
});

test("release is idempotent -- calling it twice does not throw", () => {
  const statePath = tempStateFile();
  const lock = acquireLock(statePath);
  lock.release();
  assert.doesNotThrow(() => lock.release());
});

test("a second acquireLock against a file whose lock names a live process refuses, naming the lock file and the PID", () => {
  const statePath = tempStateFile();
  // Simulate another live keeper: write a lock file that names THIS process (which is,
  // trivially, still running) rather than actually holding the lock through acquireLock,
  // so the first "holder" never registers an exit handler that would confuse the test.
  writeFileSync(`${statePath}.lock`, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  assert.throws(
    () => acquireLock(statePath),
    (err) => {
      assert.match(err.message, new RegExp(String(process.pid)));
      assert.match(err.message, /already held/);
      assert.ok(err.message.includes(`${statePath}.lock`), "message should name the lock file");
      return true;
    },
  );

  rmSync(`${statePath}.lock`);
});

test("a lock left behind by a process that is no longer running is stolen, not refused", () => {
  const statePath = tempStateFile();

  // A PID that definitely does not name a running process: spawn a child that exits
  // immediately and wait for it to be reaped, so process.kill(pid, 0) is guaranteed to
  // answer ESRCH rather than racing a process that is still shutting down.
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  assert.equal(child.status, 0);
  const deadPid = child.pid;
  assert.ok(Number.isInteger(deadPid) && deadPid > 0);

  writeFileSync(`${statePath}.lock`, JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }));

  const lock = acquireLock(statePath);
  try {
    const recorded = JSON.parse(readFileSync(`${statePath}.lock`, "utf8"));
    assert.equal(recorded.pid, process.pid, "the stale lock should now name this process");
  } finally {
    lock.release();
  }
});

test("a lock file with unreadable or unparseable content is treated as stale, not as a permanent refusal", () => {
  const statePath = tempStateFile();
  writeFileSync(`${statePath}.lock`, "not json at all {{{");

  const lock = acquireLock(statePath);
  try {
    assert.ok(existsSync(`${statePath}.lock`));
  } finally {
    lock.release();
  }
});

test("release does not delete a lock file that was stolen by someone else in the meantime", () => {
  const statePath = tempStateFile();
  const lock = acquireLock(statePath);

  // Simulate a third party stealing the lock out from under us (e.g. this process hung
  // long enough to be treated as stale by something enforcing its own timeout).
  writeFileSync(`${statePath}.lock`, JSON.stringify({ pid: 999999999, startedAt: new Date().toISOString() }));

  lock.release();
  assert.ok(existsSync(`${statePath}.lock`), "release must not remove a lock another holder now owns");

  rmSync(`${statePath}.lock`);
});

test("two acquireLock calls in immediate succession: the second sees the first as a live holder", () => {
  const statePath = tempStateFile();
  const first = acquireLock(statePath);
  try {
    assert.throws(() => acquireLock(statePath), /already held by pid \d+/);
  } finally {
    first.release();
  }
  // Now that the first has released, a third attempt succeeds.
  const third = acquireLock(statePath);
  third.release();
});
