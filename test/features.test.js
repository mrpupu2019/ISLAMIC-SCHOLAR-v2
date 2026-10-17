'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-'));
process.env.QUICKDB_PATH = path.join(tmp, 'json.sqlite');
const qaFile = path.join(tmp, 'qadata.json');
fs.copyFileSync(path.join(__dirname, '..', 'data', 'seed', 'qadata.json'), qaFile);

const config = require('../config.json');
const createBus = require('../src/core/bus');
const commands = require('../src/core/commands');
const features = require('../src/features');
const { parseQa } = require('../src/features/isdatamod');
const { findBadWord, vanityCode } = require('../src/features/filters');
const { makeClient, makeGuild, makeMember, makeMessage, makeChannel } = require('./helpers');

const MOD = config.isdatamod.modRole;
const OWNER_ROLE = config.isdatamod.ownerRole;
const tick = () => new Promise((r) => setImmediate(r));

function setup() {
  const client = makeClient();
  client.config = config;
  commands.load(client);
  const bus = createBus(client);
  features.register(bus, { client, config, env: { disabledFeatures: new Set() }, paths: { qaFile } });
  const mod = makeMember('mod-1', [MOD, OWNER_ROLE]);
  const user = makeMember('user-1');
  const target = makeMember('target-1');
  const admin = makeMember('admin-1', [], ['ADMINISTRATOR']);
  const guild = makeGuild('guild-1', [mod, user, target, admin], [MOD]);
  return { client, bus, mod, user, target, admin, guild };
}

const send = async (client, opts) => {
  const msg = makeMessage(opts);
  client.emit('message', msg);
  await tick(); await tick();
  return msg;
};

test('one Discord listener per event, even after many messages (no listener leak)', async () => {
  const { client, guild } = setup();
  for (let i = 0; i < 20; i++) await send(client, { content: `hello ${i}`, author: 'user-1', guild });
  assert.strictEqual(client.listenerCount('message'), 1);
});

test('isdatamod greetings, invite link and help reply (also in DMs) are unchanged', async () => {
  const { client, guild } = setup();
  let m = await send(client, { content: 'Salam', author: 'user-1', guild });
  assert.deepStrictEqual(m.channel.sent[0], ['Walaikum assalam']);
  m = await send(client, { content: 'invite', author: 'user-1', guild });
  assert.deepStrictEqual(m.channel.sent[0], [config.isdatamod.inviteLink]);
  m = await send(client, { content: 'help', author: 'dm-user', guild: null });
  assert.strictEqual(m.channel.sent[0][0].title, 'Need help?');
});

test('isdatamod Q&A add/remove and permission check', async () => {
  const { client, guild } = setup();
  let m = await send(client, { content: '#addqa Prayer time: Fajr is at 5:30', author: 'mod-1', guild });
  assert.match(m.channel.sent[0][0], /Added/);
  m = await send(client, { content: '#addqa Nope: x', author: 'user-1', guild });
  assert.match(m.channel.sent[0][0], /do not have permission/);
  m = await send(client, { content: '#removeqa Prayer time', author: 'mod-1', guild });
  assert.match(m.channel.sent[0][0], /Removed/);
  assert.deepStrictEqual(parseQa(' Q : A: B '), ['Q', 'A: B']);
});

test('autorcdc auto-reactions only in configured channels', async () => {
  const { client, guild } = setup();
  let m = await send(client, { content: 'hello', author: 'user-1', guild, channel: makeChannel(config.autoreact.channels[0]) });
  assert.deepStrictEqual(m.reactions, config.autoreact.emojis);
  m = await send(client, { content: 'hello', author: 'user-1', guild, channel: makeChannel('other') });
  assert.strictEqual(m.reactions.length, 0);
});

test('Islamic reminder is sent after N messages in the main chat', async () => {
  const { client, guild } = setup();
  const chat = makeChannel(config.channels.chat);
  let last;
  for (let i = 0; i < config.bot.iltifatsize; i++) last = await send(client, { content: `msg ${i}`, author: 'user-1', guild, channel: chat });
  assert.strictEqual(last.replies.length, 1);
});

test('# commands: help works, staff commands are refused for normal members', async () => {
  const { client, guild } = setup();
  let m = await send(client, { content: '#help', author: 'user-1', guild });
  const embed = m.channel.sent[0][0];
  assert.match(embed.title, /Commands/);
  assert.ok(!embed.fields.some((f) => f.name === 'Moderation'), 'members do not see moderation commands');
  m = await send(client, { content: '#ban @target spam', author: 'target-1', guild });
  assert.match(m.channel.sent[0][0].description, /do not have permission/);
});

test('removed systems are gone: ranking, register, talent', () => {
  const client = makeClient();
  commands.load(client);
  for (const name of ['stats', 'top10', 'top-record', 'male', 'woman', 'register-number', 'vip', 'designer', 'streamer', 'eval', 'fortune', 'td']) {
    assert.ok(!commands.find(client, name), `${name} should not exist`);
  }
});

test('content filter: words, evasions, Bengali, clean Islamic text', () => {
  assert.ok(findBadWord('what the fuck'));
  assert.ok(findBadWord('fuuuuck you'));
  assert.ok(findBadWord('sh1t'));
  assert.ok(findBadWord('send nudes pls'));
  assert.ok(findBadWord('তুই একটা মাগী'));
  for (const ok of ['Assalamu Alaikum', 'Alhamdulillah, Subhanallah', 'Is this halal or haram?', 'Sussex class', 'হারাম কাজ থেকে দূরে থাকুন']) {
    assert.strictEqual(findBadWord(ok), null, ok);
  }
});

test('filter deletes bad messages and foreign invites; admins are exempt', async () => {
  const { client, guild } = setup();
  let m = await send(client, { content: 'you bitch', author: 'user-1', guild });
  assert.ok(m.deleted);
  m = await send(client, { content: 'join discord.gg/abc123', author: 'user-1', guild });
  assert.ok(m.deleted);
  m = await send(client, { content: `our server ${config.bot.guildVanityURL}`, author: 'user-1', guild });
  assert.ok(!m.deleted, 'own invite is allowed');
  m = await send(client, { content: 'you bitch', author: 'admin-1', guild });
  assert.ok(!m.deleted);
  assert.strictEqual(vanityCode('https://discord.gg/PNvStcMr95/'), 'pnvstcmr95');
});
