'use strict';
const log = require('./logger');

// One Discord listener per event; every feature handler runs isolated so one failure never stops the others.
module.exports = function createBus(client) {
  const handlers = new Map();

  function dispatch(event, args) {
    for (const { feature, fn } of handlers.get(event)) {
      try {
        const result = fn(...args);
        if (result && typeof result.catch === 'function') {
          result.catch((err) => log.error(`[${feature}] ${event} failed:`, err));
        }
      } catch (err) {
        log.error(`[${feature}] ${event} failed:`, err);
      }
    }
  }

  function on(event, feature, fn) {
    if (!handlers.has(event)) {
      handlers.set(event, []);
      client.on(event, (...args) => dispatch(event, args));
    }
    handlers.get(event).push({ feature, fn });
  }

  return { on, handlers };
};
