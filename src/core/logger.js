'use strict';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

function format(arg) {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (arg && typeof arg === 'object') {
    try { return JSON.stringify(arg); } catch (_) { return String(arg); }
  }
  return String(arg);
}

function write(level, args) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${args.map(format).join(' ')}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

module.exports = {
  debug: (...a) => write('debug', a),
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
};
