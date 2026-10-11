import assert from "node:assert/strict";
import test from "node:test";
import type { WalletOperationRecord } from "../../../../packages/etf-client/src/index.js";
import { IndexedDbSubmissionJournal } from "../IndexedDbSubmissionJournal.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function serializedLocks(): LockManager {
  const tails = new Map<string, Promise<void>>();
  return {
    request: async <T>(name: string, _options: LockOptions | null, callback: (lock: Lock | null) => T | PromiseLike<T>): Promise<T> => {
      const previous = tails.get(name) ?? Promise.resolve();
      const releaseSignal = deferred<void>();
      const tail = previous.then(() => releaseSignal.promise);
      tails.set(name, tail);
      await previous;
      try {
        return await callback({ name, mode: "exclusive" } as Lock);
      } finally {
        releaseSignal.resolve();
        if (tails.get(name) === tail) tails.delete(name);
      }
    },
  } as LockManager;
}

class MemoryJournal extends IndexedDbSubmissionJournal {
  rows: WalletOperationRecord[] = [];

  override async listByPrefix(prefix: string): Promise<readonly WalletOperationRecord[]> {
    return this.rows.filter((row) => row.operationId.startsWith(prefix));
  }
}

function installLocks(locks: LockManager | undefined): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: locks === undefined ? {} : { locks },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else Reflect.deleteProperty(globalThis, "navigator");
  };
}

test("signing gate fails closed when Web Locks is unavailable", async () => {
  const restore = installLocks(undefined);
  try {
    const journal = new MemoryJournal(undefined as unknown as IDBFactory);
    await assert.rejects(journal.withSigningGate("devnet:pool:wallet:", async () => "signed"), /cross_tab_signing_lock_unavailable/);
  } finally {
    restore();
  }
});

test("signing gate blocks a new wallet prompt when the shared journal has an unresolved signature", async () => {
  const restore = installLocks(serializedLocks());
  try {
    const journal = new MemoryJournal(undefined as unknown as IDBFactory);
    journal.rows = [{
      operationId: "devnet:pool:wallet:swap:1",
      attempts: [{ signature: "sig-unknown", state: "unknown", trackedTokenAccounts: [], receipt: null }],
    }];
    let requestedWallet = false;
    await assert.rejects(
      journal.withSigningGate("devnet:pool:wallet:", async () => { requestedWallet = true; }),
      /unresolved_wallet_signature_blocks_signing/,
    );
    assert.equal(requestedWallet, false);
  } finally {
    restore();
  }
});

test("a second tab rechecks the journal after waiting for the first signing lock", async () => {
  const restore = installLocks(serializedLocks());
  try {
    const journal = new MemoryJournal(undefined as unknown as IDBFactory);
    const firstPrompt = deferred<void>();
    const finishFirst = deferred<void>();
    const first = journal.withSigningGate("devnet:pool:wallet:", async () => {
      firstPrompt.resolve();
      await finishFirst.promise;
      journal.rows = [{
        operationId: "devnet:pool:wallet:seed:2",
        attempts: [{ signature: "sig-unknown", state: "unknown", trackedTokenAccounts: [], receipt: null }],
      }];
      return "submitted";
    });
    await firstPrompt.promise;
    let secondPrompted = false;
    const second = journal.withSigningGate("devnet:pool:wallet:", async () => { secondPrompted = true; });
    finishFirst.resolve();
    assert.equal(await first, "submitted");
    await assert.rejects(second, /unresolved_wallet_signature_blocks_signing/);
    assert.equal(secondPrompted, false);
  } finally {
    restore();
  }
});
