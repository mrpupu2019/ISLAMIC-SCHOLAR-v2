'use strict';
const ui = require('../core/ui');

const TOGGLES = [
  ['selfMute', 'muted themselves', 'unmuted themselves'],
  ['selfDeaf', 'deafened themselves', 'undeafened themselves'],
  ['streaming', 'started streaming', 'stopped streaming'],
  ['selfVideo', 'turned on their camera', 'turned off their camera'],
];

module.exports = (bus, { client, config }, name) => {
  bus.on('voiceStateUpdate', name, (oldState, newState) => {
    const logChannel = client.channels.cache.get(config.logs.voicelog);
    const member = newState.member;
    if (!logChannel || !member || member.user.bot) return undefined;
    const oldCh = oldState.channel;
    const newCh = newState.channel;
    let text = null;
    if (!oldCh && newCh) text = `joined **${newCh.name}**`;
    else if (oldCh && !newCh) text = `left **${oldCh.name}**`;
    else if (oldCh && newCh && oldCh.id !== newCh.id) text = `moved from **${oldCh.name}** to **${newCh.name}**`;
    else if (newCh) {
      const change = TOGGLES.find(([key]) => oldState[key] !== newState[key]);
      if (change) text = `${newState[change[0]] ? change[1] : change[2]} in **${newCh.name}**`;
    }
    return text ? logChannel.send(ui.embed().setDescription(`${member} ${text}`)).catch(() => {}) : undefined;
  });
};
