// logger.js
const fs = require('fs'); const path = require('path'); const { EventEmitter } = require('events'); const bus = new EventEmitter();
let sockets = new Set();
const stats = { startedAt: new Date().toISOString(), ticks:0, quotes:0, opportunities:0, sent:0, succeeded:0, failed:0, estPnlUsd:0 };
const buffer = []; const BUF_MAX = 2000;
function csvPath(){ const dir = path.join(process.cwd(), 'logs'); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true }); const d = new Date(); const name = `trades-${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}.csv`; const p = path.join(dir, name); if (!fs.existsSync(p)) fs.writeFileSync(p, 'ts,level,type,router,pair,amountWei,buyAmount,estNetUsd,txHash,msg\n'); return p; }
function toMessage(level,type,data={}){ return { ts:new Date().toISOString(), level, type, ...data, stats }; }
function broadcast(msg){ const t=JSON.stringify(msg); for (const ws of sockets){ try{ ws.send(t); }catch{} } }
function appendCsv(msg){ try { const row=[msg.ts,msg.level,msg.type,(msg.router||''),(msg.pair||''),(msg.amountWei||''),(msg.buyAmount||''),(msg.estNetUsd||''),(msg.txHash||''),(msg.msg||'')].map(v=>String(v).replace(/[,\n]/g,' ')).join(',')+'\n'; fs.appendFile(csvPath(), row, ()=>{}); } catch {} }
function pushBuffer(msg){ buffer.push(msg); if (buffer.length>BUF_MAX) buffer.shift(); }
function log(level,type,data={}){ if (type==='tick') stats.ticks+=1; if (type==='quote') stats.quotes+=1; if (type==='opportunity') stats.opportunities+=1; if (type==='send') stats.sent+=1; if (type==='success'){ stats.succeeded+=1; if (typeof data.estNetUsd==='number') stats.estPnlUsd+=data.estNetUsd; } if (type==='fail') stats.failed+=1; const msg = toMessage(level,type,data); bus.emit('log', msg); broadcast(msg); pushBuffer(msg); if (['opportunity','send','success','fail','error'].includes(type)) appendCsv(msg); try{ console.log(`[${msg.level}] ${msg.type}`, data); }catch{} return msg; }
function info(type,data){ return log('info',type,data); } function warn(type,data){ return log('warn',type,data); } function error(type,data){ return log('error',type,data); }
function attachWsServer(wss, authCheck){ wss.on('connection', (ws, req) => { try{ if (authCheck && !authCheck(req)) { ws.close(); return; } sockets.add(ws); ws.send(JSON.stringify({ ts:new Date().toISOString(), level:'info', type:'hello', stats })); ws.on('close', ()=> sockets.delete(ws)); }catch{} }); }
function getStats(){ return { ...stats }; } function getBuffer(){ return buffer.slice(); }
module.exports = { bus, info, warn, error, attachWsServer, getStats, getBuffer };