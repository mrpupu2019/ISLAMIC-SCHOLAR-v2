'use strict';
const qdb = require('quick.db');
const log = require('./logger');

// Persistent timers (mute, temp role, temp ban) that survive restarts.
const MAX_DELAY = 2 ** 31 - 1;
const store = new qdb.table('timers');
const pending = new Map();
let client = null;

const ACTIONS = {
  role: async (guild, t) => {
    const member = await guild.members.fetch(t.userId).catch(() => null);
    if (member) await member.roles.remove(t.roleId, 'Timed role expired');
  },
  unban: (guild, t) => guild.members.unban(t.userId, 'Temporary ban expired'),
};

const idOf = (t) => `${t.kind || t.type}-${t.guildId}-${t.userId}-${t.roleId || 'x'}`;

async function fire(id) {
  const t = store.get(`t.${id}`);
  pending.delete(id);
  if (!t) return;
  store.delete(`t.${id}`);
  const guild = client.guilds.cache.get(t.guildId);
  if (!guild) return;
  try { await ACTIONS[t.type](guild, t); } catch (err) { log.warn(`[timers] ${t.type} failed: ${err.message}`); }
}

function arm(id, at) {
  clearTimeout(pending.get(id));
  const delay = Math.max(0, at - Date.now());
  const handle = setTimeout(() => (delay > MAX_DELAY ? arm(id, at) : fire(id)), Math.min(delay, MAX_DELAY));
  handle.unref();
  pending.set(id, handle);
}

function add(t) {
  const id = idOf(t);
  store.set(`t.${id}`, t);
  if (client) arm(id, t.at);
}

function cancel(t) {
  const id = idOf(t);
  clearTimeout(pending.get(id));
  pending.delete(id);
  store.delete(`t.${id}`);
}

function start(c) {
  client = c;
  const all = store.get('t') || {};
  Object.entries(all).forEach(([id, t]) => arm(id, t.at));
}

module.exports = { add, cancel, start };
