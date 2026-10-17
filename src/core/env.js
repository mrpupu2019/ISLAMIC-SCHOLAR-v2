'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  root,
  // DISCORD_TOKEN is the new name; TOKEN (autorcdc) and token (iscllv10allinone/isdatamod) still work.
  token: process.env.DISCORD_TOKEN || process.env.TOKEN || process.env.token,
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  disabledFeatures: new Set(list(process.env.DISABLED_FEATURES)),
  messageCacheSize: Number(process.env.MESSAGE_CACHE_SIZE || 50),
};
