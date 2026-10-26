// Local images picked in the dashboard are handed to the background worker through IndexedDB:
// runtime messages are JSON-only, and both contexts share the extension origin's database.

const DB_NAME = 'yuzgeo';
const STORE = 'assets';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function putAsset(blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  await withStore('readwrite', (store) => store.put(blob, id));
  return id;
}

export async function getAsset(id: string): Promise<Blob | null> {
  const blob = await withStore<Blob>('readonly', (store) => store.get(id));
  return blob ?? null;
}

export async function deleteAssets(ids: string[]): Promise<void> {
  await withStore('readwrite', (store) => {
    for (const id of ids) store.delete(id);
  });
}
