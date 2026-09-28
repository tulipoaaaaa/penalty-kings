/** Storage adapter: every access is wrapped, so the wallet works in private windows and with storage blocked. */
export type StorageAdapter = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

/** In-memory storage (tests, and the fallback when the browser storage throws). */
export function memoryStorage(initial: Record<string, string> = {}): StorageAdapter & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    get: key => map.get(key) ?? null,
    set: (key, value) => { map.set(key, value); },
    remove: key => { map.delete(key); },
    dump: () => Object.fromEntries(map),
  };
}

/**
 * Wraps a Web Storage getter (e.g. `() => localStorage`). Reads that throw return null; writes that throw
 * fall through to an in-memory copy so the session keeps working.
 */
export function safeStorage(get: () => Storage | undefined | null): StorageAdapter {
  const memory = memoryStorage();
  const store = () => { try { return get() ?? null; } catch { return null; } };
  return {
    get(key) {
      try { const value = store()?.getItem(key); if (value !== null && value !== undefined) return value; } catch { /* blocked */ }
      return memory.get(key);
    },
    set(key, value) {
      memory.set(key, value);
      try { store()?.setItem(key, value); } catch { /* quota or blocked: the memory copy keeps the session going */ }
    },
    remove(key) {
      memory.remove(key);
      try { store()?.removeItem(key); } catch { /* blocked */ }
    },
  };
}

/** JSON helpers with bigint support ("123n" strings), tolerant of corrupt data. */
export function readJson<T>(storage: StorageAdapter, key: string): T | null {
  try {
    const raw = storage.get(key);
    return raw ? JSON.parse(raw, (_k, v) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as T : null;
  } catch { return null; }
}
export function writeJson(storage: StorageAdapter, key: string, value: unknown) {
  try { storage.set(key, JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))); } catch { /* ignore */ }
}
