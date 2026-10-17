'use strict';
const timers = require('../core/timers');

module.exports = (bus, { client }, name) => {
  bus.on('ready', name, () => timers.start(client));
};
