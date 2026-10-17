'use strict';
const ui = require('../core/ui');

module.exports = (bus, { client, config }, name) => {
  bus.on('message', name, (message) => {
    if (message.guild || message.author.id === client.user.id) return undefined;
    const channel = client.channels.cache.get(config.channels.botdmlog);
    if (!channel) return undefined;
    return channel.send(ui.embed().setTitle('Direct Message Received')
      .addField('From', `${message.author.tag} (${message.author.id})`)
      .addField('Message', ui.clip(message.content || '(no text)'))).catch(() => {});
  });
};
