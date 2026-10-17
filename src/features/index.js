'use strict';
const log = require('../core/logger');

const FEATURES = [
  'presence',      // bot status
  'commands',      // # commands, AFK, Islamic reminders
  'members',       // welcome DM, jail re-apply on rejoin
  'filters',       // Islamic content filter: words, invites, blocked sites, nicknames
  'message-log',   // deleted message log + snipe
  'voice-log',     // voice activity log
  'dm-log',        // forwards DMs sent to the bot
  'tickets',       // ticket buttons
  'applications',  // staff application buttons
  'vanity-guard',  // vanity URL protection
  'timers',        // restores mutes / temp roles / temp bans after restart
  'isdatamod',     // isdatamod: greetings, Q&A, quick mod commands, TTS
  'autoreact',     // autorcdc: auto reactions
];

function register(bus, ctx) {
  for (const name of FEATURES) {
    if (ctx.env.disabledFeatures.has(name)) {
      log.info(`feature "${name}" disabled by DISABLED_FEATURES`);
      continue;
    }
    try {
      require(`./${name}`)(bus, ctx, name);
    } catch (err) {
      log.error(`feature "${name}" failed to start:`, err);
    }
  }
}

module.exports = { register, FEATURES };
