import type {
  WalletAttemptRecord,
  WalletOperationRecord,
  WalletSubmissionJournal,
} from "../../../packages/etf-client/src/index.js";

const DATABASE_NAME = "coloyond-etf-wallet-journal-v1";
const DATABASE_VERSION = 1;
const OPERATION_STORE = "operations";
const PREPARED_STORE = "prepared-evidence";

type StoredOperation = WalletOperationRecord & Readonly<{ evidence?: unknown }>;
type PreparedEvidence = Readonly<{ operationId: string; evidence: unknown }>;

/** Durable browser journal. IndexedDB readwrite transactions serialize its compare-and-swap updates. */
export class IndexedDbSubmissionJournal implements WalletSubmissionJournal {
  private database: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory = globalThis.indexedDB,
    private readonly databaseName = DATABASE_NAME,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error("indexed_db_unavailable"));
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OPERATION_STORE)) db.createObjectStore(OPERATION_STORE, { keyPath: "operationId" });
        if (!db.objectStoreNames.contains(PREPARED_STORE)) db.createObjectStore(PREPARED_STORE, { keyPath: "operationId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexed_db_open_failed"));
      request.onblocked = () => reject(new Error("indexed_db_open_blocked"));
    });
    return this.database;
  }

  async stageEvidence(operationId: string, evidence: unknown): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PREPARED_STORE, "readwrite");
      transaction.objectStore(PREPARED_STORE).put({ operationId, evidence } satisfies PreparedEvidence);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("indexed_db_stage_failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexed_db_stage_aborted"));
    });
  }

  async readEvidence(operationId: string): Promise<unknown | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([OPERATION_STORE, PREPARED_STORE], "readonly");
      const operationRequest = transaction.objectStore(OPERATION_STORE).get(operationId);
      const preparedRequest = transaction.objectStore(PREPARED_STORE).get(operationId);
      let operation: StoredOperation | undefined;
      let prepared: PreparedEvidence | undefined;
      operationRequest.onsuccess = () => { operation = operationRequest.result as StoredOperation | undefined; };
      preparedRequest.onsuccess = () => { prepared = preparedRequest.result as PreparedEvidence | undefined; };
      transaction.oncomplete = () => resolve(operation?.evidence ?? prepared?.evidence ?? null);
      transaction.onerror = () => reject(transaction.error ?? new Error("indexed_db_evidence_read_failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexed_db_evidence_read_aborted"));
    });
  }

  async read(operationId: string): Promise<WalletOperationRecord | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(OPERATION_STORE, "readonly");
      const request = transaction.objectStore(OPERATION_STORE).get(operationId);
      let row: StoredOperation | undefined;
      request.onsuccess = () => { row = request.result as StoredOperation | undefined; };
      transaction.oncomplete = () => resolve(row ? structuredClone(row) : null);
      transaction.onerror = () => reject(transaction.error ?? new Error("indexed_db_read_failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexed_db_read_aborted"));
    });
  }

  /** Lists persisted attempts for a wallet/pool prefix so unresolved signatures block all fresh signing. */
  async listByPrefix(prefix: string): Promise<readonly StoredOperation[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(OPERATION_STORE, "readonly");
      const request = transaction.objectStore(OPERATION_STORE).getAll();
      let rows: StoredOperation[] = [];
      request.onsuccess = () => {
        rows = (request.result as StoredOperation[]).filter((item) => item.operationId.startsWith(prefix));
      };
      transaction.oncomplete = () => resolve(structuredClone(rows));
      transaction.onerror = () => reject(transaction.error ?? new Error("indexed_db_list_failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexed_db_list_aborted"));
    });
  }

  async appendIfLatest(
    operationId: string,
    expectedLatestSignature: string | null,
    attempt: WalletAttemptRecord,
  ): Promise<boolean> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([OPERATION_STORE, PREPARED_STORE], "readwrite");
      const operations = transaction.objectStore(OPERATION_STORE);
      const prepared = transaction.objectStore(PREPARED_STORE);
      const operationRequest = operations.get(operationId);
      const evidenceRequest = prepared.get(operationId);
      let canWrite = false;
      let current: StoredOperation | undefined;
      let evidence: PreparedEvidence | undefined;
      let wrote = false;
      const maybeWrite = () => {
        if (!canWrite || operationRequest.readyState !== "done" || evidenceRequest.readyState !== "done") return;
        current = operationRequest.result as StoredOperation | undefined;
        evidence = evidenceRequest.result as PreparedEvidence | undefined;
        const latest = current?.attempts.at(-1)?.signature ?? null;
        if (latest !== expectedLatestSignature || current?.attempts.some((item) => item.signature === attempt.signature)) return;
        const row: StoredOperation = {
          operationId,
          attempts: [...(current?.attempts ?? []), structuredClone(attempt)],
          ...(evidence ? { evidence: evidence.evidence } : current?.evidence === undefined ? {} : { evidence: current.evidence }),
        };
        operations.put(row);
        prepared.delete(operationId);
        wrote = true;
      };
      operationRequest.onsuccess = () => { canWrite = evidenceRequest.readyState === "done"; maybeWrite(); };
      evidenceRequest.onsuccess = () => { canWrite = operationRequest.readyState === "done"; maybeWrite(); };
      transaction.oncomplete = () => resolve(wrote);
      transaction.onerror = () => reject(transaction.error ?? new Error("indexed_db_append_failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexed_db_append_aborted"));
    });
  }

  async replaceLatest(
    operationId: string,
    expectedSignature: string,
    attempt: WalletAttemptRecord,
  ): Promise<boolean> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(OPERATION_STORE, "readwrite");
      const store = transaction.objectStore(OPERATION_STORE);
      const request = store.get(operationId);
      let wrote = false;
      request.onsuccess = () => {
        const current = request.result as StoredOperation | undefined;
        const latest = current?.attempts.at(-1);
        if (!current || latest?.signature !== expectedSignature || attempt.signature !== expectedSignature) return;
        store.put({
          ...current,
          attempts: [...current.attempts.slice(0, -1), structuredClone(attempt)],
        } satisfies StoredOperation);
        wrote = true;
      };
      transaction.oncomplete = () => resolve(wrote);
      transaction.onerror = () => reject(transaction.error ?? new Error("indexed_db_replace_failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("indexed_db_replace_aborted"));
    });
  }
}
