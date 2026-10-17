'use strict';
// Drop-in replacement for quick.db@7 (same API, same json.sqlite format) with an in-memory
// cache and batched (write-behind) persistence to cut CPU and disk I/O.
const path = require('path');
const Database = require('better-sqlite3');

const FLUSH_MS = Number(process.env.DB_FLUSH_MS || 10000);
const stores = new Map();
let sqlite = null;
let timer = null;

function open() {
  if (!sqlite) {
    sqlite = new Database(process.env.QUICKDB_PATH || path.resolve('json.sqlite'));
    sqlite.pragma('journal_mode = WAL');
  }
  return sqlite;
}

function decode(text) {
  let value = JSON.parse(text);
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { /* plain string */ }
  }
  return value;
}

const copy = (v) => (v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v !== null && typeof v === 'object';
const isIndex = (k) => /^(0|[1-9]\d*)$/.test(k) && Number(k) < Number.MAX_SAFE_INTEGER;
// quick.db 7 stores top-level strings double-encoded; keep that so IDs never come back as numbers.
const encode = (v) => JSON.stringify(typeof v === 'string' ? JSON.stringify(v) : v);
const isEmptyObj = (v) => isObj(v) && !Array.isArray(v) && Object.keys(v).length === 0;

function getPath(obj, p) {
  let cur = obj;
  for (const k of p.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function setPath(obj, p, value) {
  const keys = p.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isObj(cur[keys[i]])) cur[keys[i]] = isIndex(keys[i + 1]) ? [] : {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

function unsetPath(obj, p) {
  const keys = p.split('.');
  const last = keys.pop();
  const parent = keys.length ? getPath(obj, keys.join('.')) : obj;
  if (isObj(parent)) delete parent[last];
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
}

function flush() {
  if (!sqlite) return;
  const pending = [...stores.values()].filter((s) => s.dirty.size || s.removed.size);
  if (!pending.length) return;
  sqlite.transaction(() => pending.forEach((s) => s.persist(sqlite)))();
}

function close() {
  if (timer) { clearTimeout(timer); timer = null; }
  flush();
  if (sqlite) { sqlite.close(); sqlite = null; }
  stores.forEach((s) => { s.rows = null; });
}

class Store {
  constructor(name) {
    if (!/^[\w\u00C0-\u024F]+$/.test(name)) throw new TypeError(`Invalid table name: ${name}`);
    this.name = name;
    this.rows = null;
    this.dirty = new Set();
    this.removed = new Set();
  }

  load() {
    if (this.rows) return this.rows;
    const db = open();
    db.prepare(`CREATE TABLE IF NOT EXISTS "${this.name}" (ID TEXT, json TEXT)`).run();
    this.rows = new Map();
    for (const row of db.prepare(`SELECT ID, json FROM "${this.name}"`).iterate()) {
      try { this.rows.set(row.ID, decode(row.json)); } catch (_) { this.rows.set(row.ID, row.json); }
    }
    return this.rows;
  }

  write(id, value) {
    this.load().set(id, value);
    this.removed.delete(id);
    this.dirty.add(id);
    schedule();
  }

  remove(id) {
    this.load().delete(id);
    this.dirty.delete(id);
    this.removed.add(id);
    schedule();
  }

  persist(db) {
    const del = db.prepare(`DELETE FROM "${this.name}" WHERE ID = ?`);
    const upd = db.prepare(`UPDATE "${this.name}" SET json = ? WHERE ID = ?`);
    const ins = db.prepare(`INSERT INTO "${this.name}" (ID, json) VALUES (?, ?)`);
    for (const id of this.removed) del.run(id);
    for (const id of this.dirty) {
      const json = encode(this.rows.get(id));
      if (upd.run(json, id).changes === 0) ins.run(id, json);
    }
    this.dirty.clear();
    this.removed.clear();
  }
}

function getStore(name) {
  if (!stores.has(name)) stores.set(name, new Store(name));
  return stores.get(name);
}

function split(key) {
  if (typeof key !== 'string' || !key) throw new TypeError('Key must be a non-empty string.');
  const i = key.indexOf('.');
  return i === -1 ? [key, null] : [key.slice(0, i), key.slice(i + 1)];
}

class Table {
  constructor(name = 'json') {
    this.tableName = name;
    this.store = getStore(name);
  }

  fetch(key) {
    const [id, p] = split(key);
    const rows = this.store.load();
    if (!rows.has(id)) return null;
    const value = rows.get(id);
    return copy(p ? getPath(value, p) : value);
  }

  get(key) { return this.fetch(key); }

  has(key) {
    const [id, p] = split(key);
    const rows = this.store.load();
    if (!rows.has(id)) return false;
    return p ? getPath(rows.get(id), p) !== undefined : true;
  }

  set(key, value) {
    if (value === undefined) throw new TypeError(`No data specified for key "${key}".`);
    const [id, p] = split(key);
    const data = copy(value);
    if (!p) { this.store.write(id, data); return copy(data); }
    const root = this.rootFor(id);
    setPath(root, p, data);
    this.store.write(id, root);
    return copy(data);
  }

  add(key, amount) {
    const n = Number(amount);
    if (Number.isNaN(n)) throw new TypeError('Data must be a number.');
    return this.update(key, (cur) => {
      if (cur === undefined || cur === null || isEmptyObj(cur)) return n;
      const num = Number(cur);
      if (Number.isNaN(num)) throw new TypeError('Target is not a number.');
      return num + n;
    });
  }

  subtract(key, amount) { return this.add(key, -Number(amount)); }

  push(key, value) {
    if (value === undefined) throw new TypeError(`No data specified for key "${key}".`);
    return this.update(key, (cur) => {
      const arr = cur === undefined || cur === null || isEmptyObj(cur) ? [] : cur;
      if (!Array.isArray(arr)) throw new TypeError('Target is not an array.');
      arr.push(copy(value));
      return arr;
    });
  }

  math(key, op, amount) {
    const n = Number(amount);
    const ops = {
      '+': (a) => a + n, add: (a) => a + n, addition: (a) => a + n,
      '-': (a) => a - n, sub: (a) => a - n, subtract: (a) => a - n,
      '*': (a) => a * n, mult: (a) => a * n, multiply: (a) => a * n,
      '/': (a) => a / n, div: (a) => a / n, divide: (a) => a / n,
      '%': (a) => a % n, mod: (a) => a % n, modulus: (a) => a % n,
      '^': (a) => a ** n, exp: (a) => a ** n, exponent: (a) => a ** n,
    };
    if (!ops[op]) throw new TypeError(`Unknown math operation: ${op}`);
    return this.update(key, (cur) => ops[op](Number(cur) || 0));
  }

  delete(key) {
    const [id, p] = split(key);
    const rows = this.store.load();
    if (!rows.has(id)) return false;
    if (!p) { this.store.remove(id); return true; }
    const root = rows.get(id);
    if (!isObj(root)) throw new TypeError('Target is not an object.');
    unsetPath(root, p);
    this.store.write(id, root);
    return true;
  }

  all() {
    return [...this.store.load().entries()].map(([ID, data]) => ({ ID, data: copy(data) }));
  }

  fetchAll() { return this.all(); }

  startsWith(text) { return this.all().filter((row) => row.ID.startsWith(text)); }

  includes(text) { return this.all().filter((row) => row.ID.includes(text)); }

  type(key) {
    const v = this.fetch(key);
    return Array.isArray(v) ? 'array' : typeof v;
  }

  rootFor(id) {
    const root = this.store.load().get(id);
    if (root === undefined || root === null) return {};
    if (!isObj(root)) throw new TypeError('Cannot target a non-object.');
    return root;
  }

  update(key, fn) {
    const [id, p] = split(key);
    const rows = this.store.load();
    if (!p) {
      const next = fn(rows.get(id));
      this.store.write(id, next);
      return copy(next);
    }
    const root = this.rootFor(id);
    const next = fn(getPath(root, p));
    setPath(root, p, next);
    this.store.write(id, root);
    return copy(next);
  }
}

const db = new Table('json');
db.table = Table;
db.flush = flush;
db.close = close;
db.version = '7.1.3-compat';
module.exports = db;
