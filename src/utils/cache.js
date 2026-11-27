const DEFAULT_TTL_MS = 20 * 60_000; // 20 minutes default origin HTML cache
const MAX_ENTRIES = 600;

class MemoryCache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs = DEFAULT_TTL_MS) {
    if (this.store.size >= MAX_ENTRIES) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  clear() {
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}

export const pageCache = new MemoryCache();
