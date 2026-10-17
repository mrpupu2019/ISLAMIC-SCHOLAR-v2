'use strict';
const fs = require('fs');
const Discord = require('discord.js');
const log = require('../core/logger');

// Bot 2 (isdatamod): prefix-less replies, Q&A database, quick moderation commands and text-to-speech.
const GREETINGS = Object.assign(Object.create(null), {
  Salam: 'Walaikum assalam',
  'salam alaikom': 'walaikum assalam',
  'Assalamu Alaikum': 'wa alaikum assalam wa rahmatullahi wa barakatuh',
  'alaikum assalam': 'wa alaikum assalam wa rahmatullahi wa barakatuh',
});
const INVITE_TRIGGERS = new Set(['invite', 'Invite', 'invt']);
const NO_PERMISSION = "You don't have permission to use this command.";

function createQaStore(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { log.warn(`[isdatamod] Q&A file not loaded (${err.message}); starting empty`); }
  let writing = Promise.resolve();
  // Write to a temp file then rename, so a crash mid-write can never leave a half-written file.
  const save = () => {
    const snapshot = JSON.stringify(data);
    writing = writing
      .then(() => fs.promises.writeFile(`${file}.tmp`, snapshot))
      .then(() => fs.promises.rename(`${file}.tmp`, file))
      .catch((err) => log.error('[isdatamod] saving Q&A failed:', err));
    return writing;
  };
  return {
    get: (q) => (Object.prototype.hasOwnProperty.call(data, q) ? data[q] : undefined),
    set: (q, a) => { data[q] = a; return save(); },
    remove: (q) => { delete data[q]; return save(); },
    count: () => Object.keys(data).length,
    answered: () => Object.values(data).filter(Boolean).length,
  };
}

// "#addqa Question: Answer" -> ["Question", "Answer"]; only the first colon separates them.
function parseQa(text) {
  const i = text.indexOf(':');
  if (i === -1) return [text.trim(), ''];
  return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
}

function modHelpEmbed(footer) {
  const fields = [
    ['#addqa', "Adds a question and answer pair to the bot's database. Example: #addqa Halal: Consume only foods that are permissible under Islamic law."],
    ['#removeqa', "Removes a question and answer pair from the bot's database. Example: #removeqa Halal"],
    ['info', 'Displays information about the user. Example: info @user'],
    ['nik', 'Changes your nickname. Example: nik @user Ahmed'],
    ['nickname', "Changes another user's nickname. Example: nickname @user Ahmed"],
    ['Nickname', "Changes another user's nickname with a custom nickname. Example: Nickname @user Ahmed"],
    ['warn', 'Warns a user for breaking the rules. Example: warn @user Spamming'],
    ['mute', 'Mutes a user for a specified amount of time. Example: mute @user'],
    ['unmute', 'Unmutes a previously muted user. Example: unmute @user'],
    ['verifygirl', 'Adds a user to the moderator role. Example: verifygirl @user'],
    ['removegirl', 'Adds a user to the moderator role. Example: removegirl @user'],
    ['kick', 'Kicks a user from the server. Example: kick @user'],
    ['bannow', 'Bans a user from the server. Example: bannow @user'],
    ['Bannow', 'Bans a user from the server. Example: Bannow @user'],
    ['#ta', 'auto tenselet autio only for admin. Example: #ta any text english or #ta text bangla'],
    ['#qastatus', 'database status only for admin. Example: #qastatus'],
  ];
  const embed = new Discord.MessageEmbed().setTitle('Mod Easy Command').setDescription('Here are the available commands:').setColor('GREEN').setFooter(footer);
  fields.forEach(([n, v]) => embed.addField(n, v));
  return embed;
}

module.exports = (bus, { client, config, paths }, name) => {
  const cfg = config.isdatamod;
  const qa = createQaStore(paths.qaFile);
  const has = (member, roleId) => member.roles.cache.has(roleId);

  async function setNickname(message, args) {
    const member = message.mentions.members.first() || message.guild.members.cache.get(args[1]);
    if (!member) return message.channel.send('Please mention a user.');
    const nickname = args.slice(2).join(' ') || cfg.randomNicknames[Math.floor(Math.random() * cfg.randomNicknames.length)];
    try {
      await member.setNickname(nickname);
      return message.channel.send(`Nickname change for ${member.displayName}: ${nickname}`);
    } catch (err) {
      return message.channel.send(`Unable to change nickname for ${member.displayName}: ${err.message}`);
    }
  }

  async function roleChange(message, roleId, add, words) {
    const member = message.mentions.members.first();
    if (!member) return message.channel.send(`Please mention a user to ${words.verb}.`);
    try {
      await (add ? member.roles.add(roleId) : member.roles.remove(roleId));
      return message.channel.send(words.ok(member));
    } catch (err) {
      return message.channel.send(words.fail(member, err));
    }
  }

  function info(message) {
    const member = message.mentions.members.first() || message.member;
    const status = member.presence.clientStatus || {};
    return message.channel.send(new Discord.MessageEmbed()
      .setColor('#00ff00')
      .setTitle(`${member.displayName}'s Info`)
      .addField('User ID', member.id)
      .addField('Joined Server On', member.joinedAt)
      .addField('Account Created On', member.user.createdAt)
      .addField('Nickname', member.nickname || 'None')
      .addField('Is on mobile', status.mobile ? 'Yes' : 'No')
      .addField('Is on computer', status.desktop ? 'Yes' : 'No'));
  }

  function warn(message) {
    const member = message.mentions.members.first();
    if (!member) return message.channel.send('Please mention a user to warn.');
    const reason = message.content.slice('warn'.length + 1).trim();
    if (!reason) return message.channel.send('Please provide a reason for the warning.');
    member.send(`You have been **warned** in ${message.guild.name} for the following reason: ${reason}`)
      .catch((err) => message.channel.send(`Failed to send a DM to ${member.displayName} with the warning reason: ${err.message}`));
    return message.channel.send(`User ${member.displayName} has been warned.`);
  }

  async function kick(message) {
    const user = message.mentions.users.first();
    if (!user) return message.reply("You didn't mention the user to kick!");
    const member = message.guild.member(user);
    if (!member) return message.reply("That user isn't in this guild!");
    if (!has(message.member, cfg.ownerRole)) return message.channel.send("You don't have the required role to execute this command!");
    try {
      await member.kick();
      return message.reply(`Successfully kicked ${user.tag}`);
    } catch (err) {
      log.warn(`[${name}] kick failed: ${err.message}`);
      return message.reply(`Failed to kick ${user.tag}`);
    }
  }

  async function ban(message) {
    if (!message.member.hasPermission('BAN_MEMBERS') && !has(message.member, cfg.ownerRole)) return undefined;
    const member = message.mentions.members.first();
    if (!member) return message.channel.send('Please mention someone');
    const banned = await member.ban();
    return message.channel.send(`Banned ${banned.user.username}!`);
  }

  function tts(message) {
    if (!has(message.member, cfg.modRole)) return message.reply(NO_PERMISSION);
    const text = message.content.slice(4);
    const lang = message.content.includes('bangla') ? 'bn' : 'en';
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(text)}&tl=${lang}`;
    return message.channel.send({ files: [{ attachment: url, name: 'play.mp3' }] });
  }

  function qaAdmin(message, word) {
    if (!message.guild.roles.cache.has(cfg.modRole)) return message.channel.send('❓ Mod role not found.');
    if (!has(message.member, cfg.modRole)) return message.channel.send('❌ You do not have permission to use this command.');
    if (word === '#addqa') {
      const [question, answer] = parseQa(message.content.slice(7));
      if (!question || !answer) return message.channel.send('❓ Usage: #addqa Question: Answer');
      qa.set(question, answer);
      return message.channel.send(`✅ **Added** new QA: ${question} -> ${answer}`);
    }
    const [question] = parseQa(message.content.slice(10));
    if (qa.get(question) === undefined) return message.channel.send(`❓ Question not found: ${question}`);
    qa.remove(question);
    return message.channel.send(`✅ **Removed** QA: ${question}`);
  }

  // Each handler is guarded by the moderator role check noted in its entry.
  const modOnly = (fn) => (message, args) => (has(message.member, cfg.modRole) ? fn(message, args) : message.reply(NO_PERMISSION));
  const muteWords = (verb, done) => ({ verb, ok: (m) => `User ${m.displayName} has been ${done}.`, fail: (m, e) => `Failed to ${verb} user ${m.displayName}: ${e.message}` });
  const girlWords = (verb, ok, fail) => ({ verb, ok: (m) => `${ok} ${m.displayName}`, fail: (m, e) => `${fail} ${m.displayName}: ${e.message}` });
  const girlOnly = (fn) => (message) => (has(message.member, cfg.girlVerifierRole) ? fn(message) : message.reply(NO_PERMISSION));

  const COMMANDS = Object.assign(Object.create(null), {
    '#addqa': (m) => qaAdmin(m, '#addqa'),
    '#removeqa': (m) => qaAdmin(m, '#removeqa'),
    '#qastatus': (m) => (has(m.member, cfg.qaStatusRole)
      ? m.channel.send(`<:wlc:977655702455738529> **Questions And Answers Database Status** <:rank:960519138328072233>\n📁 Number of **Questions**: ${qa.count()}\n📂 Number of **Answers**: ${qa.answered()}`)
      : m.reply('You do not have the required role to use this command.')),
    help: (m) => m.channel.send(new Discord.MessageEmbed().setTitle('Need help?').setDescription('Please message me in my inbox for any assistance you may need.').setColor('GREEN')),
    Command: (m) => (has(m.member, cfg.modRole) ? m.channel.send(modHelpEmbed(cfg.footer)) : m.reply(NO_PERMISSION)),
    info: modOnly(info),
    nickname: (m, a) => has(m.member, cfg.modRole) && setNickname(m, a),
    warn: modOnly(warn),
    mute: modOnly((m) => roleChange(m, cfg.muteRole, true, muteWords('mute', 'muted'))),
    unmute: modOnly((m) => roleChange(m, cfg.muteRole, false, muteWords('unmute', 'unmuted'))),
    kick,
    bannow: ban,
    verifygirl: girlOnly((m) => roleChange(m, cfg.girlRole, true, girlWords('give the role to', 'Role added successfully to', 'Failed to add role to'))),
    removegirl: girlOnly((m) => roleChange(m, cfg.girlRole, false, girlWords('take the role from', 'Role removed successfully from', 'Failed to remove role from'))),
    '#ta': tts,
  });
  const ALIASES = Object.assign(Object.create(null), { cmd: 'Command', Nickname: 'nickname', nik: 'nickname', Bannow: 'bannow' });
  // These were exact-text triggers in the original bot; the others matched the first word.
  const EXACT = new Set(['help', 'Help', 'Command', 'cmd', '#qastatus']);

  bus.on('message', name, async (message) => {
    if (message.author.id === client.user.id) return undefined;
    const { content, channel } = message;
    if (GREETINGS[content]) return channel.send(GREETINGS[content]);
    if (INVITE_TRIGGERS.has(content)) return channel.send(cfg.inviteLink);

    const answer = qa.get(content);
    if (answer) channel.send(answer);

    if (content === 'help' || content === 'Help') return COMMANDS.help(message);
    if (!message.guild || !message.member) return undefined;
    const args = content.split(' ');
    const word = args[0];
    if (EXACT.has(word) && content !== word) return undefined;
    const handler = COMMANDS[word] || COMMANDS[ALIASES[word]];
    return handler ? handler(message, args) : undefined;
  });
};

module.exports.parseQa = parseQa;
module.exports.createQaStore = createQaStore;
