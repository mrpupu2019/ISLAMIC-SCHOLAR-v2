'use strict';
const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');
const log = require('./logger');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

// Each file in src/commands exports { category, commands: [...] }.
function load(client) {
  client.commands = new Collection();
  client.aliases = new Collection();
  for (const file of fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'))) {
    const { category, commands } = require(path.join(COMMANDS_DIR, file));
    for (const cmd of commands) {
      cmd.category = category;
      client.commands.set(cmd.name, cmd);
      (cmd.aliases || []).forEach((alias) => client.aliases.set(alias, cmd.name));
    }
  }
  log.info(`commands: ${client.commands.size} commands, ${client.aliases.size} aliases loaded`);
  return client.commands;
}

const find = (client, word) => client.commands.get(word) || client.commands.get(client.aliases.get(word));

// owner > guildOwner > administrator > perm or one of the configured staff roles.
function canUse(cmd, member, client) {
  if (client.isOwner(member.id)) return true;
  if (cmd.owner) return false;
  if (cmd.guildOwner) return member.guild.ownerID === member.id;
  if (!cmd.perm && !cmd.roles) return true;
  if (member.hasPermission('ADMINISTRATOR')) return true;
  if (cmd.perm && member.hasPermission(cmd.perm)) return true;
  return (cmd.roles ? cmd.roles(client.config) : []).some((r) => r && member.roles.cache.has(r));
}

module.exports = { load, find, canUse, COMMANDS_DIR };
