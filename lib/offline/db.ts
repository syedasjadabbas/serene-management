import { type OfflineSnapshot, type QueuedOperation, snapshotsToDelete } from "./policy";

/**
 * The browser's offline store (docs/OFFLINE_ARCHITECTURE.md §G): one
 * IndexedDB database per browser profile, written only by this module.
 *
 *   meta       "session": the user the snapshots belong to (id and name only)
 *   snapshots  one minimised front-office snapshot per user AND property
 *   queue      operations made offline (phase 2; nothing enqueues yet)
 *
 * Every function degrades to a no-op when IndexedDB is unavailable (private
 * windows in some browsers, blocked storage): offline mode is a convenience,
 * never a requirement for working online.
 */

const DB_NAME = "serene-offline";
const DB_VERSION = 1;

export interface OfflineSessionMeta {
  key: "session";
  userId: string;
  displayName: string;
  /** Epoch ms of the last successful contact with the server. */
  lastOnlineAt: number;
}

const STORES = ["meta", "snapshots", "queue"];

let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= openOnce().then(async (db) => {
    // A database of this version without our stores (created by something
    // else, or half-cleared) is useless: recreate it once.
    if (!db || STORES.every((name) => db.objectStoreNames.contains(name))) return db;
    db.close();
    await new Promise((done) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = request.onerror = request.onblocked = () => done(undefined);
    });
    return openOnce();
  });
  return opening.then((db) => {
    if (!db) opening = null;
    return db;
  });
}

function openOnce(): Promise<IDBDatabase | null> {
  return new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("snapshots")) {
        const snapshots = db.createObjectStore("snapshots", { keyPath: "key" });
        snapshots.createIndex("userId", "userId");
      }
      if (!db.objectStoreNames.contains("queue")) {
        const queue = db.createObjectStore("queue", { keyPath: "id" });
        queue.createIndex("userProperty", ["userId", "propertyId"]);
        queue.createIndex("status", "status");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab deleting or upgrading the database: let it, reopen later.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      // Site data cleared by the browser closes the connection: reopen next time.
      db.onclose = () => {
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function run<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        let tx: IDBTransaction;
        try {
          tx = db.transaction(stores, mode);
        } catch {
          return resolve(undefined);
        }
        const request = work(tx);
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      }),
  );
}

/** Tells open offline views (other tabs, the indicator) that the store changed. */
function announce() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(OFFLINE_CHANNEL);
  channel.postMessage("changed");
  channel.close();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OFFLINE_CHANNEL));
}

export const OFFLINE_CHANNEL = "serene-offline";

// --- Session ownership -----------------------------------------------------

export function readSessionMeta(): Promise<OfflineSessionMeta | undefined> {
  return run<OfflineSessionMeta>(["meta"], "readonly", (tx) =>
    tx.objectStore("meta").get("session"),
  );
}

/**
 * Records who is signed in. A different user than the stored owner wipes
 * everything first: one browser, one user's offline data at a time.
 */
export async function claimSession(user: { id: string; displayName: string }): Promise<void> {
  const current = await readSessionMeta();
  if (current && current.userId !== user.id) await clearOfflineData();
  const meta: OfflineSessionMeta = {
    key: "session",
    userId: user.id,
    displayName: user.displayName,
    lastOnlineAt: Date.now(),
  };
  await run(["meta"], "readwrite", (tx) => tx.objectStore("meta").put(meta));
  announce();
}

// --- Snapshots -------------------------------------------------------------

export function saveSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  return run(["snapshots"], "readwrite", (tx) => tx.objectStore("snapshots").put(snapshot)).then(
    announce,
  );
}

export function listSnapshots(): Promise<OfflineSnapshot[]> {
  return run<OfflineSnapshot[]>(["snapshots"], "readonly", (tx) =>
    tx.objectStore("snapshots").getAll(),
  ).then((rows) => rows ?? []);
}

export function readSnapshot(key: string): Promise<OfflineSnapshot | undefined> {
  return run<OfflineSnapshot>(["snapshots"], "readonly", (tx) =>
    tx.objectStore("snapshots").get(key),
  );
}

export function deleteSnapshots(keys: string[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return run(["snapshots"], "readwrite", (tx) => {
    const store = tx.objectStore("snapshots");
    for (const key of keys) store.delete(key);
  }).then(announce);
}

/** Drops every snapshot the live session no longer justifies (see snapshotsToDelete). */
export async function reconcileSnapshots(
  me: Parameters<typeof snapshotsToDelete>[1],
): Promise<string[]> {
  const doomed = snapshotsToDelete(await listSnapshots(), me);
  await deleteSnapshots(doomed);
  return doomed;
}

// --- Queue (phase 2 contract; read-only here) -------------------------------

export function listQueue(userId: string, propertyId?: string): Promise<QueuedOperation[]> {
  return run<QueuedOperation[]>(["queue"], "readonly", (tx) =>
    tx.objectStore("queue").getAll(),
  ).then((rows) =>
    (rows ?? [])
      .filter((op) => op.userId === userId && (!propertyId || op.propertyId === propertyId))
      .sort((a, b) => a.sequence - b.sequence),
  );
}

// --- Wiping ----------------------------------------------------------------

/** Sign-out, a different user, or "Clear offline data": nothing survives. */
export async function clearOfflineData(): Promise<void> {
  await run(STORES, "readwrite", (tx) => {
    tx.objectStore("meta").clear();
    tx.objectStore("snapshots").clear();
    tx.objectStore("queue").clear();
  });
  announce();
}
