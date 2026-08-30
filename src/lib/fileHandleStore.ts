/**
 * @file lib/fileHandleStore.ts
 * @description Persistent storage for FileSystemHandle instances in IndexedDB.
 * Enables auto-sync and 1-click manual re-sync pre-navigated to the exact file/folder path.
 */

const HANDLE_DB_NAME = 'noledge_file_handles';
const HANDLE_STORE_NAME = 'handles';

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(HANDLE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        db.createObjectStore(HANDLE_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * In-memory synchronous handle cache.
 * Keeps FileSystemHandle objects instantly accessible in 0ms without waiting
 * for async IndexedDB transactions (which break Chrome user-activation gesture context).
 */
const handleInMemoryMap = new Map<string, FileSystemHandle>();

export async function saveFileHandle(id: string, handle: FileSystemHandle): Promise<void> {
  try {
    handleInMemoryMap.set(id, handle);
    if (typeof window !== 'undefined') {
      (window as any)[`file_handle_${id}`] = handle;
    }
    const db = await openHandleDB();
    const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
    tx.objectStore(HANDLE_STORE_NAME).put(handle, id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to save file handle:', err);
  }
}

export async function preloadAllFileHandles(): Promise<void> {
  try {
    const db = await openHandleDB();
    const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
    const store = tx.objectStore(HANDLE_STORE_NAME);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    await new Promise((resolve) => { tx.oncomplete = resolve; });
    const keys = keysReq.result || [];
    const vals = valsReq.result || [];
    for (let i = 0; i < keys.length; i++) {
      const k = String(keys[i]);
      const v = vals[i] as FileSystemHandle;
      if (k && v) {
        handleInMemoryMap.set(k, v);
        if (typeof window !== 'undefined') {
          (window as any)[`file_handle_${k}`] = v;
        }
      }
    }
  } catch {
    // Non-fatal
  }
}

export function getFileHandleSync(id: string): FileSystemHandle | null {
  if (handleInMemoryMap.has(id)) {
    return handleInMemoryMap.get(id)!;
  }
  if (typeof window !== 'undefined' && (window as any)[`file_handle_${id}`]) {
    return (window as any)[`file_handle_${id}`];
  }
  return null;
}

export async function getFileHandle(id: string): Promise<FileSystemHandle | null> {
  const sync = getFileHandleSync(id);
  if (sync) return sync;
  try {
    const db = await openHandleDB();
    const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
    const req = tx.objectStore(HANDLE_STORE_NAME).get(id);
    const handle = await new Promise<FileSystemHandle | null>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (handle) {
      handleInMemoryMap.set(id, handle);
      if (typeof window !== 'undefined') {
        (window as any)[`file_handle_${id}`] = handle;
      }
    }
    return handle;
  } catch {
    return null;
  }
}

/**
 * Request write permission synchronously inside the user activation frame (e.g. click event).
 * Must be called BEFORE any async await statements in event handlers.
 */
export function requestWritePermissionInGesture(handle: FileSystemHandle | null): void {
  if (!handle || typeof (handle as any).requestPermission !== 'function') return;
  try {
    // Fire requestPermission synchronously during user click
    void (handle as any).requestPermission({ mode: 'readwrite' });
  } catch {
    // Non-fatal
  }
}

export async function removeFileHandle(id: string): Promise<void> {
  handleInMemoryMap.delete(id);
  if (typeof window !== 'undefined') {
    delete (window as any)[`file_handle_${id}`];
  }
  try {
    const db = await openHandleDB();
    const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
    tx.objectStore(HANDLE_STORE_NAME).delete(id);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  }
}

