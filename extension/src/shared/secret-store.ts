const DB_NAME = 'tasker-ext-secrets';
const STORE = 'keys';
const KEY_ID = 'telegram-key';
const STORAGE_KEY = 'telegramTokenEnc';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getOrCreateKey(): Promise<CryptoKey> {
  const db = await openDb();
  try {
    const read = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID);
    const existing = (await idbReq(read)) as CryptoKey | undefined;
    if (existing) return existing;

    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const write = db.transaction(STORE, 'readwrite').objectStore(STORE).put(key, KEY_ID);
    await idbReq(write);
    return key;
  } finally {
    db.close();
  }
}

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str);
}

function fromB64(b64: string): Uint8Array {
  const str = atob(b64);
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

export async function setTelegramToken(token: string): Promise<void> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(token);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  const packed = `${toB64(iv)}:${toB64(cipher)}`;
  await chrome.storage.local.set({ [STORAGE_KEY]: packed });
}

export async function getTelegramToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const packed = stored[STORAGE_KEY] as string | undefined;
  if (!packed) return null;
  const [ivB64, cipherB64] = packed.split(':');
  if (!ivB64 || !cipherB64) return null;
  const key = await getOrCreateKey();
  try {
    const iv = fromB64(ivB64);
    const cipher = fromB64(cipherB64);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function clearTelegramToken(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export async function hasTelegramToken(): Promise<boolean> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Boolean(stored[STORAGE_KEY]);
}
