'use strict';
const qdb = require('quick.db');
const ui = require('../core/ui');
const { BUTTONS, openTicket } = require('../core/tickets');

const IDS = new Set(['ticket', 'Kilit', 'Evet', 'GeriYükle', 'DesteğiKapat', 'Hayır']);

const box = (text, type) => ui.embed(type).setDescription(text);

module.exports = (bus, { config }, name) => {
  const isStaff = (member) => member.hasPermission('MANAGE_CHANNELS')
    || Boolean(config.tickets.supportRole && member.roles.cache.has(config.tickets.supportRole));

  bus.on('clickButton', name, async (button) => {
    if (!IDS.has(button.id)) return undefined;
    const { guild } = button;
    const member = button.clicker.member || await guild.members.fetch(button.clicker.user.id);
    if (button.id === 'ticket') {
      await button.reply.think(true);
      const { channel, existing } = await openTicket(guild, member);
      return button.reply.edit(existing ? `You already have an open ticket: ${channel}` : `Your ticket has been created: ${channel}`);
    }
    const channel = button.channel;
    const owner = await guild.members.fetch(qdb.get(`destekkanal_${channel.id}`) || '0').catch(() => null);
    await button.reply.defer();
    switch (button.id) {
      case 'Kilit':
        return button.message.edit({ embed: box('Are you sure you want to close this ticket?', 'warn'), buttons: [BUTTONS.yes(), BUTTONS.no()] });
      case 'Hayır':
        return button.message.edit({ embed: box('The support team will be with you shortly.'), buttons: [BUTTONS.close()] });
      case 'Evet':
        if (owner) await channel.updateOverwrite(owner, { VIEW_CHANNEL: false });
        await button.message.delete().catch(() => {});
        return channel.send({ embed: box(`Ticket closed by ${member}.`, 'warn'), buttons: [BUTTONS.reopen(), BUTTONS.remove()] });
      case 'GeriYükle':
        if (owner) await channel.updateOverwrite(owner, { VIEW_CHANNEL: true, SEND_MESSAGES: true });
        await button.message.delete().catch(() => {});
        return channel.send({ content: owner ? `${owner}` : undefined, embed: box('This ticket has been reopened.', 'success'), buttons: [BUTTONS.close()] });
      case 'DesteğiKapat':
        if (!isStaff(member)) return undefined;
        return channel.delete('Ticket deleted');
      default:
        return undefined;
    }
  });

  const forget = (channelId, userId) => {
    qdb.delete(`destekkanal_${channelId}`);
    if (userId) qdb.delete(`destekkullanıcı_${userId}`);
  };
  bus.on('channelDelete', name, (channel) => {
    const userId = qdb.get(`destekkanal_${channel.id}`);
    if (userId) forget(channel.id, userId);
  });
  bus.on('guildMemberRemove', name, (member) => {
    const channelId = qdb.get(`destekkullanıcı_${member.id}`);
    if (!channelId) return undefined;
    forget(channelId, member.id);
    const channel = member.guild.channels.cache.get(channelId);
    return channel && channel.delete('Ticket owner left').catch(() => {});
  });
};
