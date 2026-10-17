'use strict';
const { MessageEmbed } = require('discord.js');
const config = require('../../config.json');

// One visual style for every bot message.
const COLORS = { info: '#1F8B4C', success: '#2ECC71', warn: '#E67E22', error: '#E74C3C' };

const embed = (type = 'info') => new MessageEmbed()
  .setColor(COLORS[type] || COLORS.info)
  .setFooter(config.bot.name)
  .setTimestamp();

function send(channel, text, type = 'info', title) {
  const e = embed(type).setDescription(text);
  if (title) e.setTitle(title);
  return channel.send(e);
}

const fail = (channel, text) => send(channel, text, 'error')
  .then((m) => m.delete({ timeout: 10000 }))
  .catch(() => {});

// Discord renders <t:unix:style> in every user's own timezone.
const time = (ms = Date.now(), style = 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;

const clip = (text, max = 1024) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

async function findMember(message, arg) {
  const mentioned = message.mentions.members.first();
  if (mentioned) return mentioned;
  const id = (arg || '').replace(/\D/g, '');
  return id ? message.guild.members.fetch(id).catch(() => null) : null;
}

function findRole(message, arg) {
  const id = (arg || '').replace(/\D/g, '');
  return message.mentions.roles.first() || (id && message.guild.roles.cache.get(id)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { COLORS, embed, send, fail, time, clip, findMember, findRole, sleep };
