const DEFAULT_TTL_MS = 20 * 60_000; // 20 minutes default origin HTML cache
const MAX_ENTRIES = 600;

class MemoryCache {
  constructor() {
    this.store = new Map();
    this.clearListeners = new Set();
  }

  onClear(fn) {
    if (typeof fn === 'function') this.clearListeners.add(fn);
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
    for (const fn of this.clearListeners) {
      try {
        fn();
      } catch {}
    }
  }

  size() {
    return this.store.size;
  }
}

export const pageCache = new MemoryCache();
