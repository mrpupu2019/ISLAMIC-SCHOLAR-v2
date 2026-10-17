'use strict';
const ui = require('../core/ui');
const afk = require('../core/afk');
const { canUse } = require('../core/commands');

const PERMS = [
  ['ADMINISTRATOR', 'Administrator'], ['MANAGE_GUILD', 'Manage Server'], ['MANAGE_ROLES', 'Manage Roles'],
  ['MANAGE_CHANNELS', 'Manage Channels'], ['MANAGE_MESSAGES', 'Manage Messages'], ['KICK_MEMBERS', 'Kick Members'],
  ['BAN_MEMBERS', 'Ban Members'], ['MANAGE_NICKNAMES', 'Manage Nicknames'], ['MUTE_MEMBERS', 'Mute Members'],
  ['MOVE_MEMBERS', 'Move Members'], ['VIEW_AUDIT_LOG', 'View Audit Log'],
];
const DEVICES = { desktop: 'Desktop', mobile: 'Mobile', web: 'Browser' };
const STATUS = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' };

function chunk(lines, max = 1024) {
  const out = [''];
  for (const line of lines) {
    if ((out[out.length - 1] + line).length + 1 > max) out.push('');
    out[out.length - 1] += `${line}\n`;
  }
  return out;
}

async function help({ client, config, message, args, member, channel }) {
  const p = config.bot.prefix;
  const query = (args[0] || '').toLowerCase();
  if (query) {
    const cmd = client.commands.get(query) || client.commands.get(client.aliases.get(query));
    if (!cmd) return ui.fail(channel, `No command called \`${query}\`. Type \`${p}help\` to see all commands.`);
    const e = ui.embed().setTitle(`${p}${cmd.name}`).setDescription(cmd.description)
      .addField('Usage', `\`${p}${cmd.usage || cmd.name}\``);
    if (cmd.aliases && cmd.aliases.length) e.addField('Aliases', cmd.aliases.map((a) => `\`${a}\``).join(', '));
    return channel.send(e);
  }
  const groups = new Map();
  client.commands.filter((cmd) => canUse(cmd, member, client)).forEach((cmd) => {
    if (!groups.has(cmd.category)) groups.set(cmd.category, []);
    groups.get(cmd.category).push(`\`${p}${cmd.name}\` - ${cmd.description}`);
  });
  const e = ui.embed().setTitle(`${config.bot.name} - Commands`)
    .setThumbnail(client.user.avatarURL())
    .setDescription(`Prefix: \`${p}\`  |  Details: \`${p}help <command>\`\nYou only see the commands you are allowed to use.`);
  groups.forEach((lines, category) => chunk(lines).forEach((text, i) => e.addField(i ? `${category} (cont.)` : category, text)));
  e.addField('Without prefix', '`Salam`, `Assalamu Alaikum`, `invite`, `help` and the saved Q&A questions. Moderators: type `cmd` for the moderator list.');
  return message.channel.send(e);
}

module.exports = {
  category: 'General',
  commands: [
    {
      name: 'help', aliases: ['h', 'commands'], usage: 'help [command]', description: 'Show the command list or details of one command.', run: help,
    },
    {
      name: 'avatar', aliases: ['pp', 'av'], usage: 'avatar [@member]', description: "Show a member's avatar.",
      run: async ({ message, args, member, channel }) => {
        const target = (await ui.findMember(message, args[0])) || member;
        return channel.send(ui.embed().setTitle(`${target.user.tag} - Avatar`).setImage(target.user.displayAvatarURL({ dynamic: true, size: 1024 })));
      },
    },
    {
      name: 'banner', usage: 'banner [@member]', description: "Show a member's profile banner.",
      run: async ({ client, message, args, member, channel }) => {
        const target = (await ui.findMember(message, args[0])) || member;
        const res = await fetch(`https://discord.com/api/v9/users/${target.id}`, { headers: { Authorization: `Bot ${client.token}` } });
        const { banner } = await res.json();
        if (!banner) return ui.send(channel, `${target} does not have a profile banner.`);
        const url = `https://cdn.discordapp.com/banners/${target.id}/${banner}${banner.startsWith('a_') ? '.gif' : '.png'}?size=1024`;
        return channel.send(ui.embed().setTitle(`${target.user.tag} - Banner`).setImage(url));
      },
    },
    {
      name: 'userinfo', aliases: ['info', 'whois', 'profile'], usage: 'userinfo [@member]', description: 'Show information about a member.',
      run: async ({ message, args, member, channel }) => {
        const target = (await ui.findMember(message, args[0])) || member;
        const presence = target.presence || {};
        const devices = Object.keys(presence.clientStatus || {}).map((d) => DEVICES[d] || d).join(', ') || 'None';
        const roles = target.roles.cache.filter((r) => r.id !== target.guild.id).sort((a, b) => b.position - a.position).map((r) => `${r}`);
        return channel.send(ui.embed().setTitle(target.user.tag).setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
          .addField('Nickname', target.displayName, true)
          .addField('ID', target.id, true)
          .addField('Status', STATUS[presence.status] || 'Offline', true)
          .addField('Device', devices, true)
          .addField('Account Created', ui.time(target.user.createdTimestamp), true)
          .addField('Joined Server', ui.time(target.joinedTimestamp), true)
          .addField(`Roles (${roles.length})`, ui.clip(roles.join(' ') || 'None')));
      },
    },
    {
      name: 'serverinfo', aliases: ['server', 'analyse'], usage: 'serverinfo', description: 'Show information about the server.',
      run: async ({ guild, channel }) => {
        const inVoice = guild.voiceStates.cache.filter((v) => v.channelID).size;
        return channel.send(ui.embed().setTitle(guild.name).setThumbnail(guild.iconURL({ dynamic: true }))
          .addField('Members', `${guild.memberCount}`, true)
          .addField('In Voice', `${inVoice}`, true)
          .addField('Boosts', `${guild.premiumSubscriptionCount || 0} (Level ${guild.premiumTier})`, true)
          .addField('Channels', `${guild.channels.cache.size}`, true)
          .addField('Roles', `${guild.roles.cache.size}`, true)
          .addField('Created', ui.time(guild.createdTimestamp), true));
      },
    },
    {
      name: 'afk', usage: 'afk [reason]', description: 'Set yourself as AFK. It is removed when you send a message.',
      run: async ({ args, member, author, guild, channel }) => {
        const reason = ui.clip(args.join(' ') || 'No reason given', 200);
        afk.set(guild.id, author.id, { reason, since: Date.now(), nick: member.nickname });
        if (!member.displayName.startsWith('[AFK] ')) member.setNickname(`[AFK] ${member.displayName}`.slice(0, 32)).catch(() => {});
        return ui.send(channel, `${author} is now AFK.\n**Reason:** ${reason}`, 'success');
      },
    },
    {
      name: 'where', aliases: ['voice'], usage: 'where @member', description: 'Show which voice channel a member is in.',
      run: async ({ message, args, channel }) => {
        const target = await ui.findMember(message, args[0]);
        if (!target) return ui.fail(channel, 'Please mention a member.');
        return ui.send(channel, target.voice.channel ? `${target} is in **${target.voice.channel.name}**.` : `${target} is not in a voice channel.`);
      },
    },
    {
      name: 'link', aliases: ['invite-link', 'serverlink'], usage: 'link', description: 'Show the server invite link.',
      run: async ({ config, channel }) => channel.send(config.bot.guildVanityURL),
    },
    {
      name: 'perms', aliases: ['powers'], usage: 'perms [@member]', description: 'Show the key permissions of a member.',
      run: async ({ message, args, member, channel }) => {
        const target = (await ui.findMember(message, args[0])) || member;
        const lines = PERMS.map(([flag, label]) => `${target.hasPermission(flag) ? '✅' : '❌'} ${label}`);
        return channel.send(ui.embed().setTitle(`${target.user.tag} - Permissions`).setDescription(lines.join('\n')));
      },
    },
  ],
};
