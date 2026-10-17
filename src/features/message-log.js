'use strict';
const ui = require('../core/ui');
const { filtered } = require('./filters');

// Last deleted message per guild, kept in memory only (used by #snipe).
const snipes = new Map();

module.exports = (bus, { config }, name) => {
  bus.on('messageDelete', name, (message) => {
    if (!message.guild || !message.author || message.author.bot || filtered.has(message.id)) return;
    snipes.set(message.guild.id, {
      content: message.content, authorId: message.author.id, channelId: message.channel.id,
      createdAt: message.createdTimestamp, deletedAt: Date.now(),
    });
    const channel = message.guild.channels.cache.get(config.logs.messagelog);
    if (!channel) return;
    const embed = ui.embed('error').setTitle('Message Deleted')
      .setAuthor(message.author.tag, message.author.avatarURL({ dynamic: true }))
      .addField('Channel', `${message.channel}`, true)
      .addField('Author', `${message.author} (${message.author.id})`, true)
      .setDescription(ui.clip(message.content || '(no text)', 2000));
    const file = message.attachments.first();
    if (file) embed.setImage(file.proxyURL);
    channel.send(embed).catch(() => {});
  });
};
module.exports.snipes = snipes;
