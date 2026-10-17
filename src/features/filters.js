'use strict';
const qdb = require('quick.db');
const ui = require('../core/ui');
const lists = require('../content/filter-words.json');

// Lightweight keyword + link filter that keeps the server clean and Islamic.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i', '*': 'u' };
const normalize = (s) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[013457@$!*]/g, (c) => LEET[c]);
const squeeze = (t) => t.replace(/(.)\1{2,}/g, '$1');
const SPLIT = /[^\p{L}\p{M}\p{N}]+/u;

const WORDS = new Set();
const PHRASES = [];
const FRAGMENTS = [];
for (const raw of lists.words) {
  const w = normalize(raw).trim();
  if (!/^[a-z0-9 ]+$/.test(w)) FRAGMENTS.push(w.replace(/\s+/g, ''));
  else if (w.includes(' ')) PHRASES.push(w);
  else WORDS.add(w);
}
const DOMAINS = lists.blockedSites.map((d) => d.toLowerCase());
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>]+/gi;
const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|discord\.io|dsc\.gg)\/([\w-]+)/gi;

function findBadWord(content) {
  const text = normalize(content);
  const tokens = text.split(SPLIT).filter(Boolean);
  const hit = tokens.find((t) => WORDS.has(t) || WORDS.has(squeeze(t)));
  if (hit) return hit;
  const spaced = ` ${tokens.join(' ')} `;
  const phrase = PHRASES.find((p) => spaced.includes(` ${p} `));
  if (phrase) return phrase;
  const compact = text.replace(/\s+/g, '');
  return FRAGMENTS.find((f) => compact.includes(f)) || null;
}

const vanityCode = (url) => (url || '').replace(/\/+$/, '').split('/').pop().toLowerCase();
const filtered = new Set();

module.exports = (bus, { client, config }, name) => {
  const settings = new qdb.table('settings');
  const enabled = (key, def) => { const v = settings.get(key); return v === null ? def : v; };
  const ownInvites = new Set([vanityCode(config.bot.guildVanityURL), vanityCode(config.isdatamod.inviteLink)].filter(Boolean));

  function verdict(content) {
    if (enabled('filter_words', true) && findBadWord(content)) return 'inappropriate language';
    for (const [, code] of content.matchAll(INVITE_RE)) if (!ownInvites.has(code.toLowerCase())) return 'invites to other servers';
    const urls = content.match(URL_RE) || [];
    if (urls.some((u) => DOMAINS.some((d) => u.toLowerCase().includes(d)))) return 'a blocked website';
    if (urls.length && enabled('filter_links', config.filter.blockAllLinks)) return 'links are not allowed';
    return null;
  }

  const exempt = (member) => !member || member.hasPermission('ADMINISTRATOR') || member.hasPermission('MANAGE_MESSAGES');

  async function check(msg) {
    if (!msg.guild || !msg.author || msg.author.bot || !msg.content || exempt(msg.member)) return;
    const reason = verdict(msg.content);
    if (!reason) return;
    filtered.add(msg.id);
    setTimeout(() => filtered.delete(msg.id), 60000).unref();
    await msg.delete().catch(() => {});
    ui.send(msg.channel, `${msg.author}, your message was removed (${reason}). Please keep this server respectful and in line with Islamic manners.`, 'warn')
      .then((m) => m.delete({ timeout: 6000 })).catch(() => {});
    const logChannel = client.channels.cache.get(config.logs.messagelog);
    if (logChannel) {
      logChannel.send(ui.embed('warn').setTitle('Message Filtered')
        .addField('Member', `${msg.author} (${msg.author.id})`, true)
        .addField('Channel', `${msg.channel}`, true)
        .addField('Reason', reason, true)
        .addField('Content', ui.clip(msg.content))).catch(() => {});
    }
  }

  function checkNickname(member) {
    if (!member || member.user.bot || !member.manageable || exempt(member)) return undefined;
    if (!enabled('filter_words', true) || !findBadWord(member.displayName)) return undefined;
    const names = config.isdatamod.randomNicknames;
    return member.setNickname(names[Math.floor(Math.random() * names.length)], 'Inappropriate nickname').catch(() => {});
  }

  bus.on('message', name, check);
  bus.on('messageUpdate', name, (oldMsg, msg) => (oldMsg.content !== msg.content ? check(msg) : undefined));
  bus.on('guildMemberAdd', name, checkNickname);
  bus.on('guildMemberUpdate', name, (oldMember, member) => (oldMember.displayName !== member.displayName ? checkNickname(member) : undefined));
};

module.exports.findBadWord = findBadWord;
module.exports.filtered = filtered;
module.exports.vanityCode = vanityCode;
