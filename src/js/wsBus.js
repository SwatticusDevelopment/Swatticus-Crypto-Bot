// src/js/wsBus.js
const { EventEmitter } = require('events');
const bus = new EventEmitter();
function emitTrade(tr) { bus.emit('trade', tr); }
function emitPnl(p)   { bus.emit('pnl', p); }
function on(evt, fn)  { bus.on(evt, fn); }
module.exports = { emitTrade, emitPnl, on };
