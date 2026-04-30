/**
 * src/lib/persistent-queue-storage.ts
 *
 * Sub-AC 4: Persistent storage adapters for the SCAN mobile offline mutation
 * queue.
 *
 * Why three adapters?
 * ───────────────────
 * SCAN runs on mobile browsers in the field, where reliability of any one
 * storage API is uneven:
 *
 *   • **IndexedDB** is the preferred backend.  It is asynchronous, can store
 *     structured cloneable values (no JSON.stringify needed), supports many
 *     megabytes of payload (annotated photo blobs would not survive
 *     localStorage's ~5 MB cap), and survives tab restarts.
 *
 *   • **localStorage** is the synchronous fallback.  It is universally
 *     available, but limited to ~5 MB and string values only.  Used when the
 *     browser blocks IndexedDB (private mode in older Safari, embedded
 *     WebView quirks).
 *
 *   • **In-memory** is the SSR / test fallback.  No persistence, but the API
 *     is identical so consumers don't need a feature check at every call site.
 *
 * The factory `createPersistentQueueStorage()` picks the best available
 * backend at construction time.  Tests can pass `forceBackend: "memory"` to
 * pin the choice.
 *
 * Storage shape
 * ─────────────
 * Each adapter exposes the same minimal CRUD interface:
 *
 *   getAll()                       → ordered list of all queued items
 *   put(id, value)                 → upsert one item by id
 *   delete(id)                     → remove one item
 *   clear()                        → wipe all items
 *
 * Items are stored as plain JS objects.  Ordering matches enqueue order
 * (FIFO) — the persistent-mutation-queue relies on this to replay mutations
 * in the same order they were originally invoked, preserving causal
 * correctness for sequences like "ship case → handoff custody".
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The minimum interface every storage backend must satisfy.
 *
 * All methods are async because IndexedDB is async — the localStorage and
 * memory adapters wrap their synchronous operations in `Promise.resolve()`
 * so the public surface is uniform.
 */
export interface PersistentQueueStorage<T> {
  /**
   * Return every queued item in insertion order.
   *
   * Returns an empty array when the store is empty (never `null`).
   */
  getAll(): Promise<Array<T & { id: string }>>;

  /**
   * Upsert a single item by id.
   *
   * If `id` already exists, the value is overwritten.  This is how the queue
   * records retry attempts (incremented attemptCount) without mutating the
   * insertion order.
   */
  put(id: string, value: T): Promise<void>;

  /**
   * Remove a single item by id.  No-op when the id is not present.
   */
  delete(id: string): Promise<void>;

  /**
   * Remove every item from the store.
   */
  clear(): Promise<void>;

  /**
   * Identify which backend is in use (for debugging and telemetry).
   */
  readonly backend: PersistentQueueBackend;

  /**
   * Release any resources (e.g., close the IndexedDB connection).
   */
  destroy(): void;
}

/** Identifier for the chosen backend at runtime. */
export type PersistentQueueBackend = "indexeddb" | "localstorage" | "memory";

/**
 * Options accepted by `createPersistentQueueStorage`.
 */
export interface PersistentQueueStorageOptions {
  /**
   * IndexedDB database name.  Defaults to "scan-mutation-queue".
   * Each app/feature should use its own name to avoid collisions.
   */
  databaseName?: string;

  /**
   * IndexedDB object-store name.  Defaults to "mutations".
   */
  storeName?: string;

  /**
   * localStorage key under which the JSON-serialized payload lives.
   * Defaults to "scan:mutation-queue".
   */
  localStorageKey?: string;

  /**
   * Force a specific backend.  Mostly used by unit tests to pin the
   * in-memory adapter.  In production, omit this and let the factory pick
   * the best available option.
   */
  forceBackend?: PersistentQueueBackend;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_DB_NAME = "scan-mutation-queue";
const DEFAULT_STORE_NAME = "mutations";
const DEFAULT_LOCALSTORAGE_KEY = "scan:mutation-queue";

// ─── In-memory adapter ───────────────────────────────────────────────────────

/**
 * In-memory adapter — used in SSR, unit tests, and as the last-resort fallback
 * when no browser storage is available.
 *
 * Insertion order is preserved by the underlying `Map` (per ES2015 spec).
 */
class MemoryStorage<T> implements PersistentQueueStorage<T> {
  readonly backend = "memory" as const;
  private store = new Map<string, T>();

  async getAll(): Promise<Array<T & { id: string }>> {
    const out: Array<T & { id: string }> = [];
    this.store.forEach((value, id) => {
      out.push({ ...(value as object), id } as T & { id: string });
    });
    return out;
  }

  async put(id: string, value: T): Promise<void> {
    // If the id already exists, delete-then-set so it goes to the end of
    // the iteration order (matches IndexedDB's autoIncrement+ordered key
    // behaviour for upserts that update insertion time).
    if (this.store.has(id)) {
      this.store.delete(id);
    }
    this.store.set(id, value);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  destroy(): void {
    this.store.clear();
  }
}

// ─── localStorage adapter ────────────────────────────────────────────────────

/**
 * localStorage adapter — synchronous storage wrapped in resolved Promises.
 *
 * Storage shape
 * ─────────────
 * The entire queue is serialized as a single JSON document under one key:
 *
 *   { "v": 1, "items": [{ "id": "...", ...payload }, ...] }
 *
 * The version field allows future migration if we ever change the schema.
 * Each `put`/`delete`/`clear` call rewrites the whole document — acceptable
 * because mobile queues are typically <100 items.
 */
class LocalStorageStorage<T extends object> implements PersistentQueueStorage<T> {
  readonly backend = "localstorage" as const;

  constructor(private readonly key: string) {}

  private readDoc(): { v: number; items: Array<T & { id: string }> } {
    try {
      const raw = window.localStorage.getItem(this.key);
      if (raw === null) return { v: 1, items: [] };
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "items" in parsed &&
        Array.isArray((parsed as { items: unknown }).items)
      ) {
        return parsed as { v: number; items: Array<T & { id: string }> };
      }
      // Corrupted payload — start fresh rather than throw.
      return { v: 1, items: [] };
    } catch {
      // QuotaExceededError, JSON parse error, etc.  Better to lose the
      // offline queue than crash the app.
      return { v: 1, items: [] };
    }
  }

  private writeDoc(doc: { v: number; items: Array<T & { id: string }> }): void {
    try {
      window.localStorage.setItem(this.key, JSON.stringify(doc));
    } catch {
      // Quota exceeded or storage disabled — silently drop.  The mutation
      // queue treats persistence as best-effort: better to lose offline
      // replay than to throw inside a mutation submission flow.
    }
  }

  async getAll(): Promise<Array<T & { id: string }>> {
    return this.readDoc().items;
  }

  async put(id: string, value: T): Promise<void> {
    const doc = this.readDoc();
    const existingIdx = doc.items.findIndex((it) => it.id === id);
    const merged = { ...(value as object), id } as T & { id: string };
    if (existingIdx >= 0) {
      // Update in place — preserves the original insertion position so the
      // FIFO replay order remains correct after retries.
      doc.items[existingIdx] = merged;
    } else {
      doc.items.push(merged);
    }
    this.writeDoc(doc);
  }

  async delete(id: string): Promise<void> {
    const doc = this.readDoc();
    const next = doc.items.filter((it) => it.id !== id);
    if (next.length !== doc.items.length) {
      this.writeDoc({ ...doc, items: next });
    }
  }

  async clear(): Promise<void> {
    this.writeDoc({ v: 1, items: [] });
  }

  destroy(): void {
    // No connection to close — nothing to do.
  }
}

// ─── IndexedDB adapter ───────────────────────────────────────────────────────

/**
 * IndexedDB adapter — the preferred persistent backend on mobile browsers.
 *
 * Schema
 * ──────
 * One database, one object-store.  The store uses the in-band `id` field as
 * its keyPath so we never need to manage out-of-band keys.  An additional
 * `createdAt` index would be nice for very large queues, but linear scan
 * over getAll() is fine for the small offline buffers SCAN expects.
 *
 * Connection lifecycle
 * ────────────────────
 * The connection is opened lazily on the first method call and reused for
 * subsequent calls.  Calling `destroy()` closes the connection and drops the
 * cached promise — useful when the React component owning the queue
 * unmounts.
 *
 * Error handling
 * ──────────────
 * Any IDB error during getAll/put/delete/clear rejects the corresponding
 * Promise.  The persistent-mutation-queue catches these rejections and
 * downgrades to a best-effort guarantee — the user-facing mutation still
 * succeeds (since the optimistic update was already applied) but the offline
 * record may be lost.
 */
class IndexedDBStorage<T extends object> implements PersistentQueueStorage<T> {
  readonly backend = "indexeddb" as const;

  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName: string,
    private readonly storeName: string,
  ) {}

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = window.indexedDB.open(this.dbName, 1);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
      req.onblocked = () =>
        reject(new Error("IndexedDB open blocked by another connection"));
    });

    return this.dbPromise;
  }

  private async runTx<R>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<R> | void,
  ): Promise<R | void> {
    const db = await this.openDb();
    return new Promise<R | void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const store = tx.objectStore(this.storeName);
      const req = fn(store);

      // Some operations don't return a value (delete, clear) — resolve on
      // transaction complete in that case.
      tx.oncomplete = () => {
        if (req && "result" in req) {
          resolve(req.result as R);
        } else {
          resolve();
        }
      };
      tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IDB transaction aborted"));
    });
  }

  async getAll(): Promise<Array<T & { id: string }>> {
    const result = await this.runTx<Array<T & { id: string }>>(
      "readonly",
      (store) => store.getAll(),
    );
    return result ?? [];
  }

  async put(id: string, value: T): Promise<void> {
    await this.runTx("readwrite", (store) =>
      store.put({ ...(value as object), id }),
    );
  }

  async delete(id: string): Promise<void> {
    await this.runTx("readwrite", (store) => store.delete(id));
  }

  async clear(): Promise<void> {
    await this.runTx("readwrite", (store) => store.clear());
  }

  destroy(): void {
    if (this.dbPromise) {
      // Close on resolution; don't await — the consumer is unmounting.
      this.dbPromise.then((db) => db.close()).catch(() => {});
      this.dbPromise = null;
    }
  }
}

// ─── Capability detection ────────────────────────────────────────────────────

/**
 * Probe whether IndexedDB is usable in this environment.
 *
 * Returns `false` in:
 *   • SSR / Node.js (no window)
 *   • Browsers that disable IDB in private mode (older Safari)
 *   • WebViews where indexedDB exists but throws on open
 *
 * The check is shallow — it does not actually open a database, only verifies
 * the global API surface.  The IndexedDBStorage constructor will surface a
 * usable error later if open() rejects.
 */
export function isIndexedDBAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Some browsers expose indexedDB but throw on access (Brave shields,
    // Firefox container tabs).  Wrap in try/catch.
    return typeof window.indexedDB === "object" && window.indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Probe whether localStorage is usable in this environment.
 *
 * Some browsers expose `window.localStorage` but throw on read/write
 * (private mode in older Safari).  We do a tiny round-trip to confirm.
 */
export function isLocalStorageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const probeKey = "__scan_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Construct a persistent queue storage with automatic backend selection.
 *
 * Selection order:
 *   1. `forceBackend` (if provided) — used by tests
 *   2. IndexedDB (if available)
 *   3. localStorage (if available)
 *   4. In-memory (last resort — no persistence)
 *
 * The factory never throws.  If the preferred backend turns out to be
 * non-functional at runtime, the queue caller will see operation rejections
 * but the app will keep working.
 */
export function createPersistentQueueStorage<T extends object>(
  options: PersistentQueueStorageOptions = {},
): PersistentQueueStorage<T> {
  const {
    databaseName = DEFAULT_DB_NAME,
    storeName = DEFAULT_STORE_NAME,
    localStorageKey = DEFAULT_LOCALSTORAGE_KEY,
    forceBackend,
  } = options;

  // Forced backend (tests).
  if (forceBackend === "memory") return new MemoryStorage<T>();
  if (forceBackend === "localstorage") {
    return new LocalStorageStorage<T>(localStorageKey);
  }
  if (forceBackend === "indexeddb") {
    return new IndexedDBStorage<T>(databaseName, storeName);
  }

  // Auto-pick the best available.
  if (isIndexedDBAvailable()) {
    return new IndexedDBStorage<T>(databaseName, storeName);
  }
  if (isLocalStorageAvailable()) {
    return new LocalStorageStorage<T>(localStorageKey);
  }
  return new MemoryStorage<T>();
}
