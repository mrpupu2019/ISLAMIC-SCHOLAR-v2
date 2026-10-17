'use strict';

module.exports = (bus, { config }, name) => {
  const { channels, emojis } = config.autoreact;
  const watched = new Set(channels);

  bus.on('message', name, async (message) => {
    if (!watched.has(message.channel.id)) return;
    for (const emoji of emojis) await message.react(emoji);
  });
};
