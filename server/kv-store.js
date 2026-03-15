import fs from 'node:fs';
import path from 'node:path';

export class LocalKVStore {
  constructor(storagePath) {
    this.storagePath = storagePath;
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    if (!fs.existsSync(storagePath)) {
      fs.writeFileSync(storagePath, '{}', 'utf8');
    }
  }

  readStore() {
    const raw = fs.readFileSync(this.storagePath, 'utf8');
    return JSON.parse(raw || '{}');
  }

  writeStore(data) {
    fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
  }

  async get(key) {
    const store = this.readStore();
    return store[key] ?? null;
  }

  async put(key, value) {
    const store = this.readStore();
    store[key] = String(value);
    this.writeStore(store);
  }

  async delete(key) {
    const store = this.readStore();
    delete store[key];
    this.writeStore(store);
  }

  async list(options = {}) {
    const { prefix = '', limit = 1000, cursor } = options;
    const store = this.readStore();
    const allKeys = Object.keys(store)
      .filter((key) => key.startsWith(prefix))
      .sort();

    const offset = cursor ? Number(cursor) : 0;
    const sliced = allKeys.slice(offset, offset + limit);
    const nextOffset = offset + sliced.length;

    return {
      keys: sliced.map((name) => ({ name })),
      list_complete: nextOffset >= allKeys.length,
      cursor: nextOffset >= allKeys.length ? undefined : String(nextOffset)
    };
  }
}
