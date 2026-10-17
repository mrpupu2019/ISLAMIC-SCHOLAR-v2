'use strict';
const ms = require('ms');
const qdb = require('quick.db');
const ui = require('../core/ui');
const timers = require('../core/timers');
const { welcomeDm } = require('../features/members');

const settings = new qdb.table('settings');
let bulkJob = null;

function toggle(key, label) {
  return async ({ args, channel, config }) => {
    const choice = (args[0] || '').toLowerCase();
    if (choice !== 'on' && choice !== 'off') {
      const v = settings.get(key);
      const on = v === null ? key === 'filter_words' || config.filter.blockAllLinks : v;
      return ui.send(channel, `${label} is currently **${on ? 'ON' : 'OFF'}**. Use \`on\` or \`off\` to change it.`);
    }
    settings.set(key, choice === 'on');
    return ui.send(channel, `${label} is now **${choice.toUpperCase()}**.`, 'success');
  };
}

async function staffMembers(guild, config) {
  await guild.members.fetch();
  return guild.members.cache.filter((m) => !m.user.bot && m.roles.cache.has(config.roles.staff));
}

const list = (members) => ui.clip(members.map((m) => `${m}`).join(', ') || 'Nobody');

function bulkRole(add) {
  return async ({ message, args, guild, channel }) => {
    const role = ui.findRole(message, args[0]);
    if (!role) return ui.fail(channel, 'Please mention a role.');
    if (bulkJob) return ui.fail(channel, 'Another bulk role job is already running. Please wait.');
    await guild.members.fetch();
    const targets = guild.members.cache.filter((m) => !m.user.bot && m.roles.cache.has(role.id) !== add).array();
    const status = await ui.send(channel, `${add ? 'Adding' : 'Removing'} ${role} ${add ? 'to' : 'from'} **${targets.length}** members. This takes about ${Math.ceil(targets.length * 1.2 / 60)} minute(s).`);
    bulkJob = role.id;
    let done = 0;
    for (const m of targets) {
      if (await (add ? m.roles.add(role) : m.roles.remove(role)).then(() => true).catch(() => false)) done += 1;
      await ui.sleep(1200);
    }
    bulkJob = null;
    return status.edit(ui.embed('success').setDescription(`Finished: ${role} ${add ? 'added to' : 'removed from'} **${done}/${targets.length}** members.`));
  };
}

module.exports = {
  category: 'Staff',
  commands: [
    {
      name: 'poll', aliases: ['voting'], usage: 'poll <question>', description: 'Start a yes/no poll.', perm: 'MANAGE_MESSAGES',
      run: async ({ message, args, channel, author }) => {
        const question = args.join(' ');
        if (!question) return ui.fail(channel, 'Please write the poll question.');
        await message.delete().catch(() => {});
        const poll = await channel.send(ui.embed().setTitle('Poll').setDescription(question).setFooter(`Started by ${author.tag}`));
        await poll.react('✅');
        return poll.react('❌');
      },
    },
    {
      name: 'filter', aliases: ['swear'], usage: 'filter [on|off]', description: 'Turn the inappropriate words filter on or off.', perm: 'ADMINISTRATOR',
      run: toggle('filter_words', 'The words filter'),
    },
    {
      name: 'linkfilter', aliases: ['adprotection'], usage: 'linkfilter [on|off]', description: 'Block all links (invites and blocked sites are always removed).', perm: 'ADMINISTRATOR',
      run: toggle('filter_links', 'The link filter'),
    },
    {
      name: 'roleinfo', aliases: ['audit'], usage: 'roleinfo @role', description: 'Show information about a role and who is in voice.', perm: 'MANAGE_ROLES',
      run: async ({ message, args, guild, channel }) => {
        const role = ui.findRole(message, args[0]);
        if (!role) return ui.fail(channel, 'Please mention a role or give its ID.');
        await guild.members.fetch();
        const inVoice = role.members.filter((m) => m.voice.channelID);
        return channel.send(ui.embed().setTitle(role.name).setColor(role.hexColor)
          .addField('ID', role.id, true)
          .addField('Members', `${role.members.size}`, true)
          .addField('Position', `${role.position}`, true)
          .addField('Mentionable', role.mentionable ? 'Yes' : 'No', true)
          .addField(`In Voice (${inVoice.size})`, list(inVoice)));
      },
    },
    {
      name: 'staffcheck', aliases: ['activechk', 'audiochk'], usage: 'staffcheck', description: 'Show which staff members are in voice and which are online but not in voice.', perm: 'ADMINISTRATOR',
      run: async ({ config, guild, channel }) => {
        const members = await staffMembers(guild, config);
        const inVoice = members.filter((m) => m.voice.channelID);
        const online = members.filter((m) => !m.voice.channelID && m.presence.status !== 'offline');
        return channel.send(ui.embed().setTitle(`Staff Check (${members.size})`)
          .addField(`In Voice (${inVoice.size})`, list(inVoice))
          .addField(`Online, Not in Voice (${online.size})`, list(online)));
      },
    },
    {
      name: 'staffcall', aliases: ['authorized-call'], usage: 'staffcall', description: 'DM online staff who are not in a voice channel.', perm: 'ADMINISTRATOR',
      run: async ({ config, guild, channel }) => {
        const members = (await staffMembers(guild, config)).filter((m) => !m.voice.channelID && m.presence.status !== 'offline').array();
        if (!members.length) return ui.send(channel, 'All online staff members are already in voice. Masha Allah!');
        await ui.send(channel, `Sending a reminder to **${members.length}** staff member(s).`);
        for (const m of members) {
          m.send(`Assalamu Alaikum! You are online in **${guild.name}** but not in a voice channel. Please join a voice channel when you can. JazakAllahu khairan.`).catch(() => {});
          await ui.sleep(1000);
        }
        return undefined;
      },
    },
    {
      name: 'temprole', aliases: ['limited-role'], usage: 'temprole @member @role <duration>', description: 'Give a role for a limited time.', perm: 'MANAGE_ROLES',
      run: async ({ message, args, member, guild, channel }) => {
        const target = await ui.findMember(message, args[0]);
        const role = ui.findRole(message, args[1]);
        const duration = ms(args[2] || '');
        if (!target || !role || !duration) return ui.fail(channel, 'Usage: `temprole @member @role 1d`');
        if (role.position >= member.roles.highest.position && member.id !== guild.ownerID) return ui.fail(channel, 'That role is higher than or equal to your highest role.');
        await target.roles.add(role);
        timers.add({ type: 'role', kind: 'temprole', guildId: guild.id, userId: target.id, roleId: role.id, at: Date.now() + duration });
        return ui.send(channel, `${target} received ${role} for **${ms(duration, { long: true })}**.`, 'success');
      },
    },
    {
      name: 'addroleall', usage: 'addroleall @role', description: 'Give a role to every member (slow, to respect rate limits).', guildOwner: true,
      run: bulkRole(true),
    },
    {
      name: 'removeroleall', usage: 'removeroleall @role', description: 'Remove a role from every member.', guildOwner: true,
      run: bulkRole(false),
    },
    {
      name: 'dmrole', aliases: ['dmrole-message'], usage: 'dmrole @role <message>', description: 'Send a DM to every member of a role.', perm: 'ADMINISTRATOR',
      run: async ({ message, args, guild, channel }) => {
        const role = ui.findRole(message, args[0]);
        const text = args.slice(1).join(' ');
        if (!role || !text) return ui.fail(channel, 'Usage: `dmrole @role your message`');
        await guild.members.fetch();
        const members = role.members.filter((m) => !m.user.bot).array();
        const status = await ui.send(channel, `Sending the message to **${members.length}** member(s)...`);
        let sent = 0;
        for (const m of members) {
          if (await m.send(text).then(() => true).catch(() => false)) sent += 1;
          await ui.sleep(1000);
        }
        return status.edit(ui.embed('success').setDescription(`Message delivered to **${sent}/${members.length}** member(s).`));
      },
    },
    {
      name: 'dm', usage: 'dm @member <message>', description: 'Send a DM to a member as the bot.', owner: true,
      run: async ({ message, args, channel }) => {
        const target = await ui.findMember(message, args[0]);
        const text = args.slice(1).join(' ');
        if (!target || !text) return ui.fail(channel, 'Usage: `dm @member your message`');
        await message.delete().catch(() => {});
        const ok = await target.send(text).then(() => true).catch(() => false);
        return ok ? ui.send(channel, `Message sent to ${target}.`, 'success') : ui.fail(channel, `${target} does not accept DMs.`);
      },
    },
    {
      name: 'testwelcome', usage: 'testwelcome', description: 'Send the welcome DM to yourself to preview it.', owner: true,
      run: async ({ config, member, channel }) => {
        await welcomeDm(member, config);
        return ui.send(channel, 'The welcome DM has been sent to you.', 'success');
      },
    },
    {
      name: 'reboot', aliases: ['restart'], usage: 'reboot', description: 'Restart the bot.', owner: true,
      run: async ({ channel }) => {
        await ui.send(channel, 'Restarting...', 'warn');
        qdb.close();
        process.exit(1);
      },
    },
  ],
};
