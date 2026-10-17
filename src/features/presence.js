'use strict';

module.exports = (bus, { client, config }, name) => {
  bus.on('ready', name, () => client.user.setPresence({
    activity: { name: config.bot.BotStatus },
    status: config.bot.presenceStatus || 'dnd',
  }));
};
