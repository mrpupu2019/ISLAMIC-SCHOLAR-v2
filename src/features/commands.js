'use strict';
const log = require('../core/logger');
const ui = require('../core/ui');
const afk = require('../core/afk');
const { find, canUse } = require('../core/commands');
const reminders = require('../content/reminders.json');

const COOLDOWN_MS = 2000;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

module.exports = (bus, { client, config }, name) => {
  let chatCount = 0;
  const lastUse = new Map();

  function handleAfk(message, isAfkCommand) {
    const { guild, author, member, channel } = message;
    const own = afk.get(guild.id, author.id);
    if (own && !isAfkCommand) {
      afk.clear(guild.id, author.id);
      if (member.displayName.startsWith('[AFK] ')) member.setNickname(own.nick || null).catch(() => {});
      ui.send(channel, `Welcome back ${author}, your AFK status has been removed.`, 'success')
        .then((m) => m.delete({ timeout: 8000 })).catch(() => {});
    }
    message.mentions.users.first(3).forEach((user) => {
      const data = user.id !== author.id && afk.get(guild.id, user.id);
      if (data) ui.send(channel, `**${user.username}** is AFK since ${ui.time(data.since, 'R')}.\n**Reason:** ${data.reason}`);
    });
  }

  bus.on('message', name, async (message) => {
    if (!message.guild || message.author.bot || !message.member) return undefined;
    const { content, channel, author, member } = message;

    // Islamic reminder after every N messages in the main chat (unchanged behaviour).
    if (channel.id === config.channels.chat && ++chatCount >= config.bot.iltifatsize) {
      chatCount = 0;
      message.reply(`**${pick(reminders)}**`);
    }

    const prefix = config.bot.prefix;
    const args = content.startsWith(prefix) ? content.slice(prefix.length).trim().split(/ +/g) : null;
    const word = args ? args.shift().toLowerCase() : '';
    const cmd = args && find(client, word);
    handleAfk(message, Boolean(cmd && cmd.name === 'afk'));
    if (!cmd) return undefined;

    const now = Date.now();
    if (now - (lastUse.get(author.id) || 0) < COOLDOWN_MS) return undefined;
    lastUse.set(author.id, now);
    if (!canUse(cmd, member, client)) return ui.fail(channel, 'You do not have permission to use this command.');

    try {
      await cmd.run({ client, config, message, args, member, author, channel, guild: message.guild });
    } catch (err) {
      log.error(`[commands] ${prefix}${cmd.name} failed:`, err);
      ui.fail(channel, 'Sorry, something went wrong while running that command.');
    }
    return undefined;
  });
};
