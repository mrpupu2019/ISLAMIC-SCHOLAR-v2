'use strict';
const ms = require('ms');
const db = require('quick.db');
const ui = require('../core/ui');
const timers = require('../core/timers');
const { snipes } = require('../features/message-log');

const NO_REASON = 'No reason provided';
const HOUR = 60 * 60 * 1000;
const usage = new Map();

// Ban-level commands only accept the ban staff role; the others also accept the general staff role.
const staff = (type) => (c) => (type === 'ban' ? [c.penals.ban.staff] : [c.penals[type].staff, c.roles.staff]);

// Hourly per-moderator limits for heavy actions (config penals.<type>.limit, 0 = unlimited).
function overLimit(config, type, modId) {
  const limit = config.penals[type] && config.penals[type].limit;
  if (!limit) return false;
  const key = `${type}:${modId}`;
  const now = Date.now();
  const recent = (usage.get(key) || []).filter((t) => now - t < HOUR);
  if (recent.length >= limit) return true;
  recent.push(now);
  usage.set(key, recent);
  return false;
}

function outranks(mod, target) {
  if (target.id === mod.id || target.id === mod.guild.ownerID) return false;
  if (mod.id === mod.guild.ownerID || mod.hasPermission('ADMINISTRATOR')) return true;
  return mod.roles.highest.position > target.roles.highest.position;
}

// Shared bookkeeping for every punishment: case number, record entry, log message.
function punish({ client, guild, author }, { type, logChannel, target, reason, extra }) {
  const caseNo = db.add(`punishment_${guild.id}`, 1);
  db.push(`record_${target.id}`, `**${type}** - ${reason} - by <@${author.id}> - ${ui.time()}`);
  const channel = client.channels.cache.get(logChannel);
  if (channel) {
    const e = ui.embed('warn').setTitle(`${type} | Case #${caseNo}`)
      .addField('Member', `<@${target.id}> (${target.id})`, true)
      .addField('Moderator', `${author} (${author.id})`, true)
      .addField('Reason', reason);
    if (extra) e.addField('Duration', extra, true);
    channel.send(e).catch(() => {});
  }
  return caseNo;
}

const logSimple = (client, channelId, text) => {
  const channel = client.channels.cache.get(channelId);
  if (channel) channel.send(ui.embed('success').setDescription(text)).catch(() => {});
};

async function needTarget(ctx) {
  const target = await ui.findMember(ctx.message, ctx.args[0]);
  if (!target) { ui.fail(ctx.channel, 'Please mention a member or give their ID.'); return null; }
  if (!outranks(ctx.member, target)) { ui.fail(ctx.channel, 'You cannot use this on that member (same or higher role).'); return null; }
  return target;
}

function timedRole(type, roleKey, label) {
  return async (ctx) => {
    const { config, args, channel, guild } = ctx;
    const roleId = config.penals.mute[roleKey];
    const target = await needTarget(ctx);
    if (!target) return undefined;
    const duration = ms(args[1] || '');
    if (!duration || duration < 1000) return ui.fail(channel, `Please give a valid duration, for example \`${config.bot.prefix}${type} @member 10m reason\`.`);
    if (overLimit(config, 'mute', ctx.author.id)) return ui.fail(channel, 'You have reached your hourly mute limit.');
    const reason = args.slice(2).join(' ') || NO_REASON;
    await target.roles.add(roleId, reason);
    timers.add({ type: 'role', kind: type, guildId: guild.id, userId: target.id, roleId, at: Date.now() + duration });
    const human = ms(duration, { long: true });
    const caseNo = punish(ctx, { type: label, logChannel: config.penals.mute.log, target, reason, extra: human });
    return ui.send(channel, `${target} has been ${label === 'MUTE' ? 'muted' : 'voice muted'} for **${human}**.\n**Reason:** ${reason}\n**Case:** #${caseNo}`, 'success');
  };
}

function removeRole(kind, roleKey, text) {
  return async (ctx) => {
    const { client, config, guild, channel, author } = ctx;
    const roleId = config.penals.mute[roleKey];
    const target = await ui.findMember(ctx.message, ctx.args[0]);
    if (!target) return ui.fail(channel, 'Please mention a member or give their ID.');
    await target.roles.remove(roleId);
    timers.cancel({ type: 'role', kind, guildId: guild.id, userId: target.id, roleId });
    logSimple(client, config.penals.mute.log, `${target} was ${text} by ${author}.`);
    return ui.send(channel, `${target} has been ${text}.`, 'success');
  };
}

async function ban(ctx, temporary) {
  const { config, args, channel, guild, author } = ctx;
  const id = (args[0] || '').replace(/\D/g, '');
  if (!id) return ui.fail(channel, 'Please mention a member or give their ID.');
  const target = await guild.members.fetch(id).catch(() => null);
  if (target && (!outranks(ctx.member, target) || !target.bannable)) return ui.fail(channel, 'I cannot ban that member (same or higher role).');
  const duration = temporary ? ms(args[1] || '') : null;
  if (temporary && (!duration || duration < 60000)) return ui.fail(channel, `Please give a valid duration, for example \`${config.bot.prefix}tempban @member 7d reason\`.`);
  if (overLimit(config, 'ban', author.id)) return ui.fail(channel, 'You have reached your hourly ban limit.');
  const reason = args.slice(temporary ? 2 : 1).join(' ') || NO_REASON;
  if (target) await target.send(`You have been banned from **${guild.name}**${temporary ? ` for ${ms(duration, { long: true })}` : ''}.\n**Reason:** ${reason}`).catch(() => {});
  await guild.members.ban(id, { reason: `${reason} | by ${author.tag}` });
  if (temporary) timers.add({ type: 'unban', guildId: guild.id, userId: id, at: Date.now() + duration });
  const human = temporary ? ms(duration, { long: true }) : null;
  const caseNo = punish(ctx, { type: temporary ? 'TEMPBAN' : 'BAN', logChannel: config.penals.ban.log, target: { id }, reason, extra: human });
  return ui.send(channel, `<@${id}> has been banned${human ? ` for **${human}**` : ''}.\n**Reason:** ${reason}\n**Case:** #${caseNo}`, 'success');
}

module.exports = {
  category: 'Moderation',
  commands: [
    {
      name: 'warn', usage: 'warn @member <reason>', description: 'Warn a member (saved in their record).', roles: staff('warn'),
      run: async (ctx) => {
        const target = await needTarget(ctx);
        if (!target) return undefined;
        const reason = ctx.args.slice(1).join(' ');
        if (!reason) return ui.fail(ctx.channel, 'Please give a reason for the warning.');
        db.push(`warns_${target.id}`, `${reason} - by <@${ctx.author.id}> - ${ui.time()}`);
        const caseNo = punish(ctx, { type: 'WARN', logChannel: ctx.config.penals.warn.log, target, reason });
        target.send(`You have been warned in **${ctx.guild.name}**.\n**Reason:** ${reason}`).catch(() => {});
        return ui.send(ctx.channel, `${target} has been warned.\n**Reason:** ${reason}\n**Case:** #${caseNo}`, 'success');
      },
    },
    {
      name: 'warnings', aliases: ['warns'], usage: 'warnings @member', description: "Show a member's warnings.", roles: staff('warn'),
      run: async ({ message, args, channel }) => {
        const target = await ui.findMember(message, args[0]);
        if (!target) return ui.fail(channel, 'Please mention a member or give their ID.');
        const warns = db.get(`warns_${target.id}`) || [];
        if (!warns.length) return ui.send(channel, `${target} has no warnings.`);
        return channel.send(ui.embed().setTitle(`Warnings - ${target.user.tag} (${warns.length})`).setDescription(ui.clip(warns.slice(-15).join('\n'), 4000)));
      },
    },
    {
      name: 'mute', usage: 'mute @member <duration> [reason]', description: 'Mute a member in text chat for a time (e.g. 10m, 2h, 1d).', roles: staff('mute'),
      run: timedRole('mute', 'roles', 'MUTE'),
    },
    {
      name: 'unmute', usage: 'unmute @member', description: 'Remove a chat mute.', roles: staff('mute'),
      run: removeRole('mute', 'roles', 'unmuted'),
    },
    {
      name: 'vmute', usage: 'vmute @member <duration> [reason]', description: 'Mute a member in voice channels for a time.', roles: staff('mute'),
      run: timedRole('vmute', 'vmuterole', 'VOICE MUTE'),
    },
    {
      name: 'unvmute', usage: 'unvmute @member', description: 'Remove a voice mute.', roles: staff('mute'),
      run: removeRole('vmute', 'vmuterole', 'voice unmuted'),
    },
    {
      name: 'jail', usage: 'jail @member [reason]', description: 'Put a member in jail (removes their roles until released).', perm: 'BAN_MEMBERS', roles: staff('jail'),
      run: async (ctx) => {
        const { config, guild, channel, author } = ctx;
        const target = await needTarget(ctx);
        if (!target) return undefined;
        if (db.get(`jail.${target.id}`)) return ui.fail(channel, `${target} is already in jail.`);
        if (!target.manageable) return ui.fail(channel, 'I cannot manage that member (their role is above mine).');
        if (overLimit(config, 'jail', author.id)) return ui.fail(channel, 'You have reached your hourly jail limit.');
        const reason = ctx.args.slice(1).join(' ') || NO_REASON;
        const saved = target.roles.cache.filter((r) => r.id !== guild.id && !r.managed).map((r) => r.id);
        const managed = target.roles.cache.filter((r) => r.managed).map((r) => r.id);
        await target.roles.set([...managed, config.penals.jail.roles], reason);
        db.set(`jail.${target.id}`, saved);
        const caseNo = punish(ctx, { type: 'JAIL', logChannel: config.penals.jail.log, target, reason });
        return ui.send(channel, `${target} has been jailed.\n**Reason:** ${reason}\n**Case:** #${caseNo}`, 'success');
      },
    },
    {
      name: 'unjail', usage: 'unjail @member', description: 'Release a member from jail and give their roles back.', perm: 'BAN_MEMBERS', roles: staff('jail'),
      run: async ({ client, config, message, args, guild, channel, author }) => {
        const target = await ui.findMember(message, args[0]);
        if (!target) return ui.fail(channel, 'Please mention a member or give their ID.');
        const saved = db.get(`jail.${target.id}`);
        if (!saved) return ui.fail(channel, `${target} is not in jail.`);
        const managed = target.roles.cache.filter((r) => r.managed).map((r) => r.id);
        await target.roles.set([...managed, ...saved.filter((id) => guild.roles.cache.has(id))], `Released by ${author.tag}`);
        db.delete(`jail.${target.id}`);
        logSimple(client, config.penals.jail.log, `${target} was released from jail by ${author}.`);
        return ui.send(channel, `${target} has been released from jail.`, 'success');
      },
    },
    {
      name: 'ban', usage: 'ban @member|ID [reason]', description: 'Ban a member from the server.', perm: 'BAN_MEMBERS', roles: staff('ban'),
      run: (ctx) => ban(ctx, false),
    },
    {
      name: 'tempban', aliases: ['tmban'], usage: 'tempban @member|ID <duration> [reason]', description: 'Ban a member for a time (e.g. 7d).', perm: 'BAN_MEMBERS', roles: staff('ban'),
      run: (ctx) => ban(ctx, true),
    },
    {
      name: 'unban', usage: 'unban <ID>', description: 'Unban a user by ID.', perm: 'BAN_MEMBERS', roles: staff('ban'),
      run: async ({ client, config, args, guild, channel, author }) => {
        const id = (args[0] || '').replace(/\D/g, '');
        if (!id) return ui.fail(channel, 'Please give the user ID.');
        const ok = await guild.members.unban(id, `Unbanned by ${author.tag}`).then(() => true).catch(() => false);
        if (!ok) return ui.fail(channel, 'That user is not banned.');
        timers.cancel({ type: 'unban', guildId: guild.id, userId: id });
        logSimple(client, config.penals.ban.log, `<@${id}> (${id}) was unbanned by ${author}.`);
        return ui.send(channel, `<@${id}> has been unbanned.`, 'success');
      },
    },
    {
      name: 'baninfo', aliases: ['ban-info'], usage: 'baninfo <ID>', description: 'Show why a user was banned.', perm: 'BAN_MEMBERS', roles: staff('ban'),
      run: async ({ args, guild, channel }) => {
        const id = (args[0] || '').replace(/\D/g, '');
        const entry = id && await guild.fetchBan(id).catch(() => null);
        if (!entry) return ui.fail(channel, 'That user is not banned.');
        return ui.send(channel, `**${entry.user.tag}** (${entry.user.id})\n**Reason:** ${entry.reason || NO_REASON}`);
      },
    },
    {
      name: 'banlist', usage: 'banlist', description: 'List banned users.', perm: 'BAN_MEMBERS',
      run: async ({ guild, channel }) => {
        const bans = await guild.fetchBans();
        if (!bans.size) return ui.send(channel, 'Nobody is banned on this server.');
        const list = bans.first(60).map((b) => `\`${b.user.tag}\``).join(', ');
        return channel.send(ui.embed().setTitle(`Banned Users (${bans.size})`).setDescription(ui.clip(list, 4000)));
      },
    },
    {
      name: 'record', aliases: ['history'], usage: 'record @member', description: "Show a member's punishment record.", roles: staff('warn'),
      run: async ({ message, args, channel }) => {
        const target = await ui.findMember(message, args[0]);
        if (!target) return ui.fail(channel, 'Please mention a member or give their ID.');
        const entries = [...(db.get(`sicil_${target.id}`) || []), ...(db.get(`record_${target.id}`) || [])];
        if (!entries.length) return ui.send(channel, `${target} has a clean record.`);
        return channel.send(ui.embed().setTitle(`Record - ${target.user.tag} (${entries.length})`).setDescription(ui.clip(entries.slice(-15).join('\n'), 4000)));
      },
    },
    {
      name: 'clearrecord', aliases: ['user-reset'], usage: 'clearrecord @member', description: "Clear a member's record and warnings.", perm: 'ADMINISTRATOR',
      run: async ({ message, args, channel }) => {
        const target = await ui.findMember(message, args[0]);
        if (!target) return ui.fail(channel, 'Please mention a member or give their ID.');
        ['record_', 'sicil_', 'warns_'].forEach((k) => db.delete(`${k}${target.id}`));
        return ui.send(channel, `The record of ${target} has been cleared.`, 'success');
      },
    },
    {
      name: 'vckick', aliases: ['disconnect'], usage: 'vckick @member', description: 'Disconnect a member from voice.', perm: 'MOVE_MEMBERS', roles: staff('ban'),
      run: async (ctx) => {
        const target = await needTarget(ctx);
        if (!target) return undefined;
        if (!target.voice.channelID) return ui.fail(ctx.channel, `${target} is not in a voice channel.`);
        await target.voice.setChannel(null);
        return ui.send(ctx.channel, `${target} has been disconnected from voice.`, 'success');
      },
    },
    {
      name: 'clear', aliases: ['delete', 'purge'], usage: 'clear <1-100> [@member]', description: 'Delete recent messages (optionally only from one member).', perm: 'MANAGE_MESSAGES',
      run: async ({ message, args, channel }) => {
        const amount = Number(args[0]);
        if (!Number.isInteger(amount) || amount < 1 || amount > 100) return ui.fail(channel, 'Please give a number between 1 and 100.');
        const target = message.mentions.users.first();
        await message.delete().catch(() => {});
        let messages = await channel.messages.fetch({ limit: 100 });
        messages = messages.filter((m) => !target || m.author.id === target.id).first(amount);
        const deleted = await channel.bulkDelete(messages, true);
        return ui.send(channel, `Deleted **${deleted.size}** message(s). Messages older than 14 days cannot be deleted.`, 'success')
          .then((m) => m.delete({ timeout: 5000 })).catch(() => {});
      },
    },
    {
      name: 'snipe', usage: 'snipe', description: 'Show the last deleted message.', perm: 'MANAGE_MESSAGES', roles: (c) => [c.roles.staff],
      run: async ({ guild, channel }) => {
        const data = snipes.get(guild.id);
        if (!data) return ui.send(channel, 'No deleted message has been recorded since the bot started.');
        return channel.send(ui.embed().setTitle('Last Deleted Message')
          .setDescription(ui.clip(data.content || '(no text)', 2000))
          .addField('Author', `<@${data.authorId}>`, true)
          .addField('Channel', `<#${data.channelId}>`, true)
          .addField('Deleted', ui.time(data.deletedAt, 'R'), true));
      },
    },
    {
      name: 'lock', usage: 'lock', description: 'Stop everyone from sending messages in this channel.', perm: 'MANAGE_CHANNELS',
      run: async ({ guild, channel }) => {
        await channel.updateOverwrite(guild.roles.everyone, { SEND_MESSAGES: false });
        return ui.send(channel, '🔒 This channel has been locked.', 'warn');
      },
    },
    {
      name: 'unlock', usage: 'unlock', description: 'Allow messages in this channel again.', perm: 'MANAGE_CHANNELS',
      run: async ({ guild, channel }) => {
        await channel.updateOverwrite(guild.roles.everyone, { SEND_MESSAGES: null });
        return ui.send(channel, '🔓 This channel has been unlocked.', 'success');
      },
    },
  ],
};
