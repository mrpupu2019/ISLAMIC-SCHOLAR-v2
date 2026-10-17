'use strict';
const buttons = require('discord-buttons');
const qdb = require('quick.db');
const config = require('../../config.json');
const ui = require('./ui');

const CATEGORY = 'SUPPORT TICKETS';

const button = (style, label, id, emoji) => {
  const b = new buttons.MessageButton().setStyle(style).setLabel(label).setID(id);
  return emoji ? b.setEmoji(emoji) : b;
};

// Button IDs are kept from the original bot so panels already posted in the server keep working.
const BUTTONS = {
  open: () => button('green', 'Create Ticket', 'ticket', '📩'),
  close: () => button('grey', 'Close Ticket', 'Kilit', '🔒'),
  yes: () => button('green', 'Yes, close it', 'Evet'),
  no: () => button('red', 'Cancel', 'Hayır'),
  reopen: () => button('green', 'Reopen', 'GeriYükle'),
  remove: () => button('red', 'Delete Ticket', 'DesteğiKapat'),
};

// Returns { channel, existing } where existing is true if the member already has an open ticket.
async function openTicket(guild, member, reason) {
  const existingId = qdb.get(`destekkullanıcı_${member.id}`);
  const existing = existingId && guild.channels.cache.get(existingId);
  if (existing) return { channel: existing, existing: true };
  const supportRole = config.tickets.supportRole;
  const category = guild.channels.cache.find((c) => c.type === 'category' && c.name === CATEGORY)
    || await guild.channels.create(CATEGORY, { type: 'category' });
  const overwrites = [
    { id: guild.roles.everyone.id, deny: ['VIEW_CHANNEL'] },
    { id: member.id, allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'ATTACH_FILES'] },
  ];
  if (supportRole) overwrites.push({ id: supportRole, allow: ['VIEW_CHANNEL', 'SEND_MESSAGES'] });
  const channel = await guild.channels.create(`ticket-${member.user.username}`.slice(0, 90), {
    type: 'text', parent: category.id, permissionOverwrites: overwrites, reason: `Ticket for ${member.user.tag}`,
  });
  qdb.set(`destekkanal_${channel.id}`, member.id);
  qdb.set(`destekkullanıcı_${member.id}`, channel.id);
  const e = ui.embed().setTitle('Support Ticket')
    .setDescription(`Assalamu Alaikum ${member}, the support team will be with you shortly.${reason ? `\n\n**Reason:** ${reason}` : ''}`);
  await channel.send({ content: `${member}${supportRole ? ` <@&${supportRole}>` : ''}`, embed: e, buttons: [BUTTONS.close()] });
  return { channel, existing: false };
}

module.exports = { BUTTONS, openTicket };
