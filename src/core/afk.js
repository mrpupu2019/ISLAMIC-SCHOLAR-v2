'use strict';
const db = require('quick.db');

const key = (guildId, userId) => `afk.${guildId}.${userId}`;

module.exports = {
  get: (guildId, userId) => db.get(key(guildId, userId)),
  set: (guildId, userId, data) => db.set(key(guildId, userId), data),
  clear: (guildId, userId) => db.delete(key(guildId, userId)),
};
