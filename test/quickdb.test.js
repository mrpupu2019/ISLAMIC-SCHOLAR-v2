'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qdb-'));
fs.copyFileSync(path.join(__dirname, '..', 'data', 'seed', 'json.sqlite'), path.join(tmp, 'json.sqlite'));
process.env.QUICKDB_PATH = path.join(tmp, 'json.sqlite');
process.env.DB_FLUSH_MS = '50';
const db = require('quick.db');
const Database = require('better-sqlite3');

test('reads data written by the original quick.db (including double-encoded values)', () => {
  const row = new Database(process.env.QUICKDB_PATH, { readonly: true }).prepare("SELECT ID FROM json WHERE ID LIKE 'record_%' LIMIT 1").get();
  const record = db.get(row.ID);
  assert.ok(Array.isArray(record), 'record_ value should decode to an array');
});

test('get/set/has/delete with dotted paths behave like quick.db 7', () => {
  assert.strictEqual(db.get('missing_key'), null);
  db.set('snipe.123', { mesaj: 'hi', kanal: '9' });
  assert.deepStrictEqual(db.get('snipe.123'), { mesaj: 'hi', kanal: '9' });
  assert.strictEqual(db.get('snipe.123.mesaj'), 'hi');
  assert.strictEqual(db.has('snipe.123'), true);
  assert.strictEqual(db.has('snipe.999'), false);
  db.delete('snipe.123.mesaj');
  assert.strictEqual(db.get('snipe.123.mesaj'), undefined);
  assert.strictEqual(db.delete('nope'), false);
  assert.throws(() => db.set('x', undefined));
});

test('add/subtract/push/math and returned values are copies', () => {
  db.add('points_1', 5);
  db.add('points_1', 5);
  db.subtract('points_1', 3);
  assert.strictEqual(db.get('points_1'), 7);
  db.push('record_1', 'warn');
  db.push('record_1', 'mute');
  assert.deepStrictEqual(db.get('record_1'), ['warn', 'mute']);
  db.get('record_1').push('mutated');
  assert.strictEqual(db.get('record_1').length, 2);
  assert.strictEqual(db.math('points_1', '*', 2), 14);
  assert.throws(() => db.add('record_1', 1), /not a number/);
  assert.throws(() => db.push('points_1', 1), /not an array/);
  const t = new db.table('stats_daily');
  t.add('stats_daily.g.u.channels.c', 100);
  t.add('stats_daily.g.u.channels.c', 50);
  assert.strictEqual(t.get('stats_daily.g.u.channels.c'), 150);
  assert.ok(db.all().some((r) => r.ID === 'points_1'));
  assert.ok(db.startsWith('record_').length >= 1);
});

test('ID strings survive a save/reload as strings (quick.db 7 double-encoding)', () => {
  db.set('user_42_1', '630773653415395340');
  db.set('flag_text', 'true');
  db.close();
  assert.strictEqual(db.get('user_42_1'), '630773653415395340');
  assert.strictEqual(db.get('flag_text'), 'true');
  db.set('o3.list.0', 'a');
  assert.deepStrictEqual(db.get('o3'), { list: ['a'] });
});

test('batched writes are persisted in the original quick.db format', async () => {
  db.set('persist_check', { a: 1 });
  await new Promise((r) => setTimeout(r, 150));
  const raw = new Database(process.env.QUICKDB_PATH, { readonly: true }).prepare("SELECT json FROM json WHERE ID = 'persist_check'").get();
  assert.deepStrictEqual(JSON.parse(raw.json), { a: 1 });
  db.delete('persist_check');
  db.close();
  const after = new Database(process.env.QUICKDB_PATH, { readonly: true }).prepare("SELECT json FROM json WHERE ID = 'persist_check'").get();
  assert.strictEqual(after, undefined);
  assert.strictEqual(db.get('points_1'), 14, 'data reloads from disk after close');
  db.close();
});
