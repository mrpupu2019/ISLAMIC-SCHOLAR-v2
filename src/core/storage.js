'use strict';
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const SEED_DIR = path.join(__dirname, '..', '..', 'data', 'seed');
const SEEDED_FILES = ['json.sqlite', 'qadata.json'];

// Make sure the data folder exists and first-run copies of the original bots' data are in place.
function prepare(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const file of SEEDED_FILES) {
    const target = path.join(dataDir, file);
    const seed = path.join(SEED_DIR, file);
    if (!fs.existsSync(target) && fs.existsSync(seed)) {
      fs.copyFileSync(seed, target);
      log.info(`storage: seeded ${file} into ${dataDir}`);
    }
  }
  process.env.QUICKDB_PATH = path.join(dataDir, 'json.sqlite');
  return { qaFile: path.join(dataDir, 'qadata.json') };
}

module.exports = { prepare };
