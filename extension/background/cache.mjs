const DAY = 86400000;

export class TranslationCache {
  constructor() { this.memory = new Map(); this.dbPromise = null; }
  database() {
    if (!this.dbPromise) this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('clearling-translations', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('translations', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.dbPromise = null; reject(new Error('CACHE_UNAVAILABLE')); };
    });
    return this.dbPromise;
  }
  async get(key, days = 30, memoryOnly = false) {
    const memoryKey = `${memoryOnly ? 'private' : 'normal'}:${key}`;
    let item = this.memory.get(memoryKey);
    if (!item && !memoryOnly) {
      try {
        const db = await this.database();
        item = await new Promise(resolve => { const r = db.transaction('translations').objectStore('translations').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); });
      } catch { return null; }
    }
    if (!item || item.time < Date.now() - days * DAY) return null;
    this.memory.set(memoryKey, item);
    if (this.memory.size > 1500) this.memory.delete(this.memory.keys().next().value);
    return item.text;
  }
  async put(key, text, memoryOnly = false) {
    const item = { key, text, time: Date.now() };
    this.memory.set(`${memoryOnly ? 'private' : 'normal'}:${key}`, item);
    if (this.memory.size > 1500) this.memory.delete(this.memory.keys().next().value);
    if (!memoryOnly) {
      try {
        const db = await this.database();
        await new Promise(resolve => { const t = db.transaction('translations', 'readwrite'); t.objectStore('translations').put(item); t.oncomplete = resolve; t.onerror = resolve; });
      } catch { /* Translation remains usable without persistent cache. */ }
    }
  }
  async prune(days = 30) {
    try {
      const db = await this.database();
      await new Promise(resolve => {
        const transaction = db.transaction('translations', 'readwrite');
        let count = 0;
        const request = transaction.objectStore('translations').openCursor(null, 'prev');
        request.onsuccess = () => { const cursor = request.result; if (!cursor) return; count++; if (cursor.value.time < Date.now() - days * DAY || count > 10000) cursor.delete(); cursor.continue(); };
        transaction.oncomplete = resolve; transaction.onerror = resolve;
      });
    } catch { /* Cache maintenance is best effort. */ }
  }
  async clear() {
    this.memory.clear();
    const db = await this.database();
    await new Promise((resolve, reject) => { const t = db.transaction('translations', 'readwrite'); t.objectStore('translations').clear(); t.oncomplete = resolve; t.onerror = () => reject(new Error('CACHE_UNAVAILABLE')); });
  }
}
