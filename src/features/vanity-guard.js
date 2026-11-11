'use strict';
const log = require('../core/logger');
const { vanityCode } = require('./filters');

module.exports = (bus, { client, config }, name) => {
  bus.on('guildUpdate', name, async (oldGuild, newGuild) => {
    if (oldGuild.vanityURLCode === newGuild.vanityURLCode) return;
    const entry = (await newGuild.fetchAuditLogs({ type: 'GUILD_UPDATE', limit: 1 }).catch(() => null)) || {};
    if (!entry || !entry.entries || !entry.entries.first()) return;
    const e = entry.entries.first();
    if (!e || !e.executor || e.executor.id === client.user.id || e.executor.id === newGuild.ownerID) return;
    const text = `${e.executor} (${e.executor.tag}) changed the server vanity URL and was banned. The URL is being restored.`;
    const channel = client.channels.cache.get(config.channels.urlguardlog);
    if (channel) channel.send(text);
    else if (newGuild.owner) newGuild.owner.send(text).catch(() => {});
    const code = vanityCode(config.bot.guildVanityURL);
    if (code) {
      const res = await fetch(`https://discord.com/api/v9/guilds/${newGuild.id}/vanity-url`, {
        method: 'PATCH',
        headers: { Authorization: `Bot ${client.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) log.warn(`[${name}] restoring vanity URL failed: HTTP ${res.status}`);
    }
    await newGuild.members.ban(entry.executor.id, { reason: 'Vanity URL protection: changed the server vanity URL.' })
      .catch((err) => log.warn(`[${name}] could not ban ${entry.executor.tag}: ${err.message}`));
  });
};
