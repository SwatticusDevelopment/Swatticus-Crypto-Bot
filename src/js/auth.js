// auth.js
const crypto = require('crypto');
function b64url(input){ return Buffer.from(input).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function hmac(secret,data){ return crypto.createHmac('sha256', secret).update(data).digest('base64url'); }
function parseCookies(h=''){ return Object.fromEntries(h.split(';').map(v=>v.trim().split('=').map(decodeURIComponent)).filter(kv=>kv[0])); }
function loadUsersFromEnv(){ const users={}; const list=(process.env.DASHBOARD_USERS||'').split(',').map(s=>s.trim()).filter(Boolean); for(const u of list){ const pass=process.env[`DASHBOARD_PASS_${u}`]; if (pass) users[u]=pass; } return users; }
function signSession(username, secret, ttlMs=12*60*60*1000){ const payload={u:username,exp:Date.now()+ttlMs}; const data=b64url(JSON.stringify(payload)); const sig=hmac(secret,data); return `${data}.${sig}`; }
function verifySession(token, secret){ if(!token||!secret) return null; const [data,sig]=token.split('.'); if(!data||!sig) return null; const expect=hmac(secret,data); if(!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null; const payload=JSON.parse(Buffer.from(data,'base64').toString('utf8')); if(!payload||payload.exp<Date.now()) return null; return payload; }
module.exports = { parseCookies, loadUsersFromEnv, signSession, verifySession };