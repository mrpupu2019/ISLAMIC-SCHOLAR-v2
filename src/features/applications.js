'use strict';
const buttons = require('discord-buttons');
const db = require('quick.db');
const ui = require('../core/ui');

module.exports = (bus, { client, config }, name) => {
  const cfg = config.applications;
  const done = (label, style) => new buttons.MessageButton().setLabel(label).setStyle(style).setID(`done-${style}`).setDisabled();
  const result = (text) => {
    const channel = client.channels.cache.get(cfg.resultChannel);
    return channel && channel.send(ui.embed().setTitle('Staff Application').setDescription(text));
  };

  async function approve(btn, applicantId) {
    await btn.message.edit(`Application of <@${applicantId}> approved by ${btn.clicker.user.tag}.`, done('Approved', 'green'));
    const member = await btn.guild.members.fetch(applicantId).catch(() => null);
    if (member && cfg.approvedRole) await member.roles.add(cfg.approvedRole).catch(() => {});
    if (member) member.send(`Assalamu Alaikum! Your staff application in **${btn.guild.name}** has been approved. Welcome to the team, may Allah make it easy for you.`).catch(() => {});
    return result(`<@${applicantId}>'s application was **approved** by ${btn.clicker.user}.`);
  }

  async function reject(btn, applicantId) {
    await btn.channel.send(`${btn.clicker.user}, please type the reason for rejection (3 minutes).`);
    const filter = (m) => m.author.id === btn.clicker.user.id;
    const collected = await btn.channel.awaitMessages(filter, { max: 1, time: 3 * 60 * 1000 });
    if (!collected.size) return btn.channel.send('Time is up. The application was not rejected.');
    const reason = ui.clip(collected.first().content, 500);
    db.delete(`basvur.${btn.message.id}`);
    await btn.message.edit(`Application of <@${applicantId}> rejected by ${btn.clicker.user.tag}. Reason: ${reason}`, done('Rejected', 'red'));
    const user = await client.users.fetch(applicantId).catch(() => null);
    if (user) user.send(`Assalamu Alaikum. Your staff application in **${btn.guild.name}** was not accepted this time.\n**Reason:** ${reason}`).catch(() => {});
    return result(`<@${applicantId}>'s application was **rejected** by ${btn.clicker.user}.\n**Reason:** ${reason}`);
  }

  bus.on('clickButton', name, async (btn) => {
    if (btn.id !== 'onay' && btn.id !== 'red') return undefined;
    const applicantId = db.get(`basvur.${btn.message.id}`);
    if (!applicantId) return undefined;
    const clicker = btn.clicker.member || await btn.guild.members.fetch(btn.clicker.user.id);
    const allowed = clicker.hasPermission('ADMINISTRATOR') || (cfg.managerRole && clicker.roles.cache.has(cfg.managerRole));
    if (!allowed) return btn.reply.send('Only the application managers can do this.', true);
    await btn.reply.defer();
    if (btn.id === 'red') return reject(btn, applicantId);
    db.delete(`basvur.${btn.message.id}`);
    return approve(btn, applicantId);
  });
};
