'use strict';
const buttons = require('discord-buttons');
const db = require('quick.db');
const ui = require('../core/ui');
const { BUTTONS, openTicket } = require('../core/tickets');

const QUESTIONS = [
  'How old are you?',
  'How many hours a day can you be active?',
  'Are you staff on any other server? If yes, which one?',
  'Do you have basic Islamic knowledge (Quran, Sunnah, adab)? Tell us briefly.',
  'How will you help this community?',
  'Why do you want to join the staff team?',
];
const ANSWER_TIME = 3 * 60 * 1000;
const appRoles = (c) => [c.applications.managerRole];

async function apply({ client, config, message, guild, author, channel }) {
  const cfg = config.applications;
  await message.delete().catch(() => {});
  if (db.get('basvurbilgi')) return ui.fail(channel, 'Staff applications are closed at the moment.');
  if (db.get(`applyban_${author.id}`) || db.get(`ban.${author.id}`) === true) return ui.fail(channel, 'You are not allowed to apply.');
  const logChannel = client.channels.cache.get(cfg.logChannel);
  if (!logChannel) return ui.fail(channel, 'Applications are not set up yet. Please contact an admin.');
  const overwrites = [
    { id: guild.roles.everyone.id, deny: ['VIEW_CHANNEL'] },
    { id: author.id, allow: ['VIEW_CHANNEL', 'SEND_MESSAGES'] },
  ];
  if (cfg.managerRole) overwrites.push({ id: cfg.managerRole, allow: ['VIEW_CHANNEL'] });
  const room = await guild.channels.create(`apply-${author.username}`.slice(0, 90), { type: 'text', parent: cfg.category || undefined, permissionOverwrites: overwrites });
  await room.send(`Assalamu Alaikum ${author}! Please answer ${QUESTIONS.length} short questions. You have ${ANSWER_TIME / 60000} minutes for each answer.`);
  const answers = [];
  for (const [i, question] of QUESTIONS.entries()) {
    await room.send(ui.embed().setDescription(`**${i + 1}/${QUESTIONS.length}.** ${question}`));
    const got = await room.awaitMessages((m) => m.author.id === author.id, { max: 1, time: ANSWER_TIME });
    if (!got.size) break;
    answers.push(ui.clip(got.first().content, 1000));
  }
  const complete = answers.length === QUESTIONS.length;
  await room.send(complete ? 'JazakAllahu khairan! Your application has been sent to the team. This channel will close in 10 seconds.' : 'Time is up. This channel will close in 10 seconds.');
  setTimeout(() => room.delete().catch(() => {}), 10000);
  if (!complete) return undefined;
  const e = ui.embed().setTitle('New Staff Application').setAuthor(`${author.tag} (${author.id})`, author.avatarURL({ dynamic: true }));
  QUESTIONS.forEach((q, i) => e.addField(q, answers[i]));
  const approve = new buttons.MessageButton().setLabel('Approve').setStyle('green').setID('onay');
  const reject = new buttons.MessageButton().setLabel('Reject').setStyle('red').setID('red');
  const posted = await logChannel.send({ embed: e, buttons: [approve, reject] });
  db.set(`basvur.${posted.id}`, author.id);
  return undefined;
}

module.exports = {
  category: 'Support',
  commands: [
    {
      name: 'ticketpanel', aliases: ['ticket'], usage: 'ticketpanel', description: 'Post the "Create Ticket" panel in this channel.', perm: 'ADMINISTRATOR',
      run: async ({ config, message, channel }) => {
        await message.delete().catch(() => {});
        const e = ui.embed().setTitle('Support Tickets')
          .setDescription('Need help from the team? Click the button below to open a private ticket.')
          .setImage(config.welcomeDm.image);
        return channel.send({ embed: e, buttons: [BUTTONS.open()] });
      },
    },
    {
      name: 'livesupport', aliases: ['support'], usage: 'livesupport <reason>', description: 'Open a private support ticket with the team.',
      run: async ({ message, args, member, guild, channel }) => {
        const reason = ui.clip(args.join(' '), 500);
        if (!reason) return ui.fail(channel, 'Please tell us briefly why you need support. Example: `livesupport I have a question`');
        await message.delete().catch(() => {});
        const { channel: ticket, existing } = await openTicket(guild, member, reason);
        return ui.send(channel, existing ? `${member}, you already have an open ticket: ${ticket}` : `${member}, your ticket has been opened: ${ticket}`, 'success');
      },
    },
    {
      name: 'apply', usage: 'apply', description: 'Apply to join the staff team.', run: apply,
    },
    {
      name: 'applications', aliases: ['application-status'], usage: 'applications <on|off>', description: 'Open or close staff applications.', perm: 'ADMINISTRATOR', roles: appRoles,
      run: async ({ args, channel }) => {
        const choice = (args[0] || '').toLowerCase();
        if (choice === 'on') db.delete('basvurbilgi');
        else if (choice === 'off') db.set('basvurbilgi', true);
        else return ui.send(channel, `Staff applications are currently **${db.get('basvurbilgi') ? 'CLOSED' : 'OPEN'}**. Use \`on\` or \`off\`.`);
        return ui.send(channel, `Staff applications are now **${choice === 'on' ? 'OPEN' : 'CLOSED'}**.`, 'success');
      },
    },
    {
      name: 'applyban', aliases: ['apply-ban'], usage: 'applyban <add|remove> @member', description: 'Block or unblock a member from applying.', perm: 'ADMINISTRATOR', roles: appRoles,
      run: async ({ message, args, channel }) => {
        const action = (args[0] || '').toLowerCase();
        const target = await ui.findMember(message, args[1]);
        if (!target || (action !== 'add' && action !== 'remove')) return ui.fail(channel, 'Usage: `applyban add @member` or `applyban remove @member`');
        if (action === 'add') db.set(`applyban_${target.id}`, true);
        else { db.delete(`applyban_${target.id}`); db.delete(`ban.${target.id}`); }
        return ui.send(channel, `${target} can ${action === 'add' ? 'no longer' : 'now'} apply for staff.`, 'success');
      },
    },
  ],
};
