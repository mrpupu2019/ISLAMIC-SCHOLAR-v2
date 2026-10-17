'use strict';
// Offline tests for # commands (moderation, help, filter toggle) using richer fake discord.js objects.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-'));
process.env.QUICKDB_PATH = path.join(tmp, 'json.sqlite');
const qaFile = path.join(tmp, 'qadata.json');
fs.copyFileSync(path.join(__dirname, '..', 'data', 'seed', 'qadata.json'), qaFile);

const { Collection } = require('discord.js');
const db = require('quick.db');
const config = require('../config.json');
const createBus = require('../src/core/bus');
const commands = require('../src/core/commands');
const features = require('../src/features');
const { makeClient } = require('./helpers');

// Every message moves the clock 3s forward so the 2s per-user command cooldown never blocks a test.
let clock = Date.now();
const realNow = Date.now;
Date.now = () => clock;
const tick = () => new Promise((r) => setImmediate(r));
const flushAsync = async () => { for (let i = 0; i < 6; i++) await tick(); };

const STAFF = config.roles.staff;
const MUTE = config.penals.mute.roles;
const JAIL = config.penals.jail.roles;

function role(id, position = 1, managed = false) { return { id, position, managed, toString: () => `<@&${id}>` }; }

function channel(id = 'chan') {
  const sent = [];
  const msgs = new Collection();
  for (let i = 0; i < 20; i++) msgs.set(`m${i}`, { id: `m${i}`, author: { id: i % 2 ? 'target' : 'user' } });
  const ch = {
    id, type: 'text', name: id, sent, overwrites: [], bulk: null,
    toString: () => `<#${id}>`,
    send: async (...args) => { sent.push(args); return { args, delete: async () => {}, edit: async () => {}, react: async () => {} }; },
    messages: { fetch: async () => msgs },
    bulkDelete: async (list) => { ch.bulk = list; return new Collection(list.map((m) => [m.id, m])); },
    updateOverwrite: async (target, perms) => { ch.overwrites.push([target, perms]); },
  };
  return ch;
}

function member(id, roles = [], perms = [], guildRoles) {
  const cache = new Collection(roles.map((r) => [r.id, r]));
  const m = {
    id, nickname: null, displayName: `user-${id}`, manageable: true, bannable: true, dms: [],
    user: { id, bot: false, tag: `user#${id}`, username: `user${id}`, displayAvatarURL: () => null, avatarURL: () => null },
    roles: {
      cache,
      get highest() { return [...cache.values()].sort((a, b) => b.position - a.position)[0] || { position: 0 }; },
      add: async (r) => { const rid = r.id || r; cache.set(rid, guildRoles.get(rid) || role(rid)); },
      remove: async (r) => { cache.delete(r.id || r); },
      set: async (ids) => { cache.clear(); ids.forEach((rid) => cache.set(rid, guildRoles.get(rid) || role(rid))); },
    },
    hasPermission: (p) => perms.includes(p) || perms.includes('ADMINISTRATOR'),
    setNickname: async (n) => { m.nickname = n; },
    send: async (t) => { m.dms.push(t); },
    voice: { channelID: null, channel: null },
    presence: { status: 'online' },
    toString: () => `<@${id}>`,
  };
  return m;
}

function setup() {
  const guildRoles = new Collection([[STAFF, role(STAFF, 10)], [MUTE, role(MUTE, 2)], [JAIL, role(JAIL, 3)], ['r-old', role('r-old', 1)]]);
  const mod = member('mod', [guildRoles.get(STAFF)], [], guildRoles);
  const user = member('user', [], [], guildRoles);
  const target = member('target', [guildRoles.get('r-old')], [], guildRoles);
  const admin = member('admin', [], ['ADMINISTRATOR'], guildRoles);
  const cleaner = member('cleaner', [], ['MANAGE_MESSAGES'], guildRoles);
  const all = new Collection([mod, user, target, admin, cleaner].map((m) => [m.id, m]));
  const guild = {
    id: 'guild-1', name: 'Test Guild', ownerID: 'owner-x', memberCount: all.size,
    roles: { cache: guildRoles, everyone: { id: 'guild-1' } },
    members: { cache: all, fetch: async (uid) => (uid ? all.get(uid) || Promise.reject(new Error('unknown')) : all) },
    channels: { cache: new Map() },
  };
  all.forEach((m) => { m.guild = guild; });
  const client = makeClient();
  client.config = config;
  client.token = 'fake';
  commands.load(client);
  const bus = createBus(client);
  features.register(bus, { client, config, env: { disabledFeatures: new Set() }, paths: { qaFile } });
  return { client, guild, mod, user, target, admin, cleaner };
}

async function run(ctx, content, authorId, mentions = [], ch = channel()) {
  clock += 3000;
  const m = ctx.guild.members.cache.get(authorId);
  const msg = {
    id: `msg-${Math.random()}`, content, guild: ctx.guild, member: m, channel: ch, author: m.user, deleted: false,
    mentions: {
      members: { first: () => mentions[0] },
      users: { first: (n) => (n === undefined ? mentions[0] && mentions[0].user : mentions.slice(0, n).map((x) => x.user)) },
      roles: { first: () => undefined },
    },
    attachments: { first: () => undefined },
    reply: async () => ({ delete: async () => {} }),
    react: async () => {},
    delete: async () => { msg.deleted = true; return msg; },
  };
  ctx.client.emit('message', msg);
  await flushAsync();
  return { msg, ch, desc: () => ch.sent.map((a) => (a[0] && a[0].description) || a[0]).join(' | ') };
}

test('#warn: success, saved, DM sent; missing reason and non-staff refused', async () => {
  const ctx = setup();
  let r = await run(ctx, '#warn <@target> spamming links', 'mod', [ctx.target]);
  assert.match(r.desc(), /has been warned/);
  assert.strictEqual((db.get('warns_target') || []).length, 1);
  assert.match(ctx.target.dms[0], /warned/);
  r = await run(ctx, '#warn <@target>', 'mod', [ctx.target]);
  assert.match(r.desc(), /give a reason/);
  r = await run(ctx, '#warn <@target> x', 'user', [ctx.target]);
  assert.match(r.desc(), /do not have permission/);
  r = await run(ctx, '#warnings <@target>', 'mod', [ctx.target]);
  assert.match(r.ch.sent[0][0].title, /Warnings/);
});

test('#mute with duration adds role + persistent timer; #unmute removes both', async () => {
  const ctx = setup();
  let r = await run(ctx, '#mute <@target> 10m spam', 'mod', [ctx.target]);
  assert.match(r.desc(), /muted for \*\*10 minutes\*\*/);
  assert.ok(ctx.target.roles.cache.has(MUTE));
  const timers = new db.table('timers').get('t') || {};
  assert.ok(Object.values(timers).some((t) => t.userId === 'target' && t.roleId === MUTE));
  r = await run(ctx, '#mute <@target> abc', 'mod', [ctx.target]);
  assert.match(r.desc(), /valid duration/);
  r = await run(ctx, '#unmute <@target>', 'mod', [ctx.target]);
  assert.match(r.desc(), /unmuted/);
  assert.ok(!ctx.target.roles.cache.has(MUTE));
  const after = new db.table('timers').get('t') || {};
  assert.ok(!Object.values(after).some((t) => t.userId === 'target' && t.roleId === MUTE));
});

test('#mute cannot target a member with an equal/higher role', async () => {
  const ctx = setup();
  const r = await run(ctx, '#mute <@mod> 10m', 'mod', [ctx.mod]);
  assert.match(r.desc(), /cannot use this/);
});

test('#jail saves roles and sets the jail role; #unjail restores them', async () => {
  const ctx = setup();
  let r = await run(ctx, '#jail <@target> trolling', 'mod', [ctx.target]);
  assert.match(r.desc(), /has been jailed/);
  assert.deepStrictEqual([...ctx.target.roles.cache.keys()], [JAIL]);
  assert.deepStrictEqual(db.get('jail.target'), ['r-old']);
  r = await run(ctx, '#jail <@target>', 'mod', [ctx.target]);
  assert.match(r.desc(), /already in jail/);
  r = await run(ctx, '#unjail <@target>', 'mod', [ctx.target]);
  assert.match(r.desc(), /released/);
  assert.deepStrictEqual([...ctx.target.roles.cache.keys()], ['r-old']);
  assert.ok(!db.get('jail.target'));
});

test('#clear: validates the amount, bulk deletes, filters by member', async () => {
  const ctx = setup();
  let r = await run(ctx, '#clear 0', 'cleaner');
  assert.match(r.desc(), /between 1 and 100/);
  r = await run(ctx, '#clear 150', 'cleaner');
  assert.match(r.desc(), /between 1 and 100/);
  r = await run(ctx, '#clear 5', 'cleaner');
  assert.strictEqual(r.ch.bulk.length, 5);
  assert.match(r.desc(), /Deleted \*\*5\*\*/);
  r = await run(ctx, '#clear 3 <@target>', 'cleaner', [ctx.target]);
  assert.ok(r.ch.bulk.every((m) => m.author.id === 'target'));
  r = await run(ctx, '#clear 5', 'user');
  assert.match(r.desc(), /do not have permission/);
});

test('#help <command> and unknown command', async () => {
  const ctx = setup();
  let r = await run(ctx, '#help warn', 'user');
  assert.strictEqual(r.ch.sent[0][0].title, '#warn');
  r = await run(ctx, '#help mute', 'user');
  assert.ok(r.ch.sent[0][0].fields.some((f) => f.name === 'Usage'));
  r = await run(ctx, '#help nosuchcmd', 'user');
  assert.match(r.desc(), /No command called/);
  r = await run(ctx, '#help', 'mod');
  assert.ok(r.ch.sent[0][0].fields.some((f) => f.name === 'Moderation'), 'staff see moderation');
  assert.ok(r.ch.sent[0][0].fields.length <= 25);
});

test('#filter off/on toggles the words filter (admin only)', async () => {
  const ctx = setup();
  let r = await run(ctx, '#filter off', 'user');
  assert.match(r.desc(), /do not have permission/);
  r = await run(ctx, '#filter off', 'admin');
  assert.match(r.desc(), /now \*\*OFF\*\*/);
  r = await run(ctx, 'you bitch', 'user');
  assert.ok(!r.msg.deleted, 'filter off: not deleted');
  r = await run(ctx, 'join discord.gg/otherserver', 'user');
  assert.ok(r.msg.deleted, 'invites are always removed');
  r = await run(ctx, '#filter on', 'admin');
  r = await run(ctx, 'you bitch', 'user');
  assert.ok(r.msg.deleted, 'filter on: deleted');
  r = await run(ctx, '#filter', 'admin');
  assert.match(r.desc(), /currently \*\*ON\*\*/);
  r = await run(ctx, 'Assalamu Alaikum, is this haram? Alhamdulillah', 'user');
  assert.ok(!r.msg.deleted);
  r = await run(ctx, 'check pornhub.com/x', 'user');
  assert.ok(r.msg.deleted, 'blocked site');
});

test('#lock / #unlock / #ban permission + success', async () => {
  const ctx = setup();
  let r = await run(ctx, '#lock', 'admin');
  assert.strictEqual(r.ch.overwrites[0][1].SEND_MESSAGES, false);
  r = await run(ctx, '#unlock', 'admin');
  assert.strictEqual(r.ch.overwrites[0][1].SEND_MESSAGES, null);
  let banned = null;
  ctx.guild.members.ban = async (id) => { banned = id; };
  // ban parses the ID from the first argument, so use a numeric ID like real Discord snowflakes.
  ctx.target.id = '111'; ctx.target.user.id = '111'; ctx.guild.members.cache.set('111', ctx.target);
  r = await run(ctx, '#ban <@111> spam', 'admin', [ctx.target]);
  assert.strictEqual(banned, '111', 'administrators skip the role hierarchy check');
  assert.match(r.desc(), /has been banned/);
  banned = null;
  r = await run(ctx, '#ban <@111> spam', 'mod', [ctx.target]);
  assert.strictEqual(banned, null, 'the general staff role cannot ban without the ban staff role');
  assert.match(r.desc(), /do not have permission/);
});

test.after(() => { Date.now = realNow; db.close(); });
