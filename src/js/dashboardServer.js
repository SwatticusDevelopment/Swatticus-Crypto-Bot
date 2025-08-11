// dashboardServer.js — preserves your HTML; injects tiny Start/Stop helpers
const fs = require('fs'); const path = require('path'); const http = require('http'); const WebSocket = require('ws');
const { attachWsServer, getStats, getBuffer } = require('./logger');
const { parseCookies, loadUsersFromEnv, signSession, verifySession } = require('./auth');
const worker = require('./chainWorker');
const PORT = parseInt(process.env.DASHBOARD_PORT || '8787', 10); const HOST = process.env.DASHBOARD_HOST || '0.0.0.0'; const SECRET = process.env.DASHBOARD_SECRET || 'change-me';
const indexHtml = fs.readFileSync(path.join(__dirname, '../html/dashboard.html'), 'utf8');
const loginHtml = fs.readFileSync(path.join(__dirname, '../html/login.html'), 'utf8');
const settingsHtml= fs.readFileSync(path.join(__dirname, '../html/settings.html'), 'utf8');

const helperJs = `
<script>
window.SWAT = {
  async start(){ const r=await fetch('/api/start',{method:'POST',credentials:'include'}); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); },
  async stop(){ const r=await fetch('/api/stop',{method:'POST',credentials:'include'}); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); },
  async status(){ const r=await fetch('/api/status',{credentials:'include'}); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
};
(function wire(){
  const startBtn = document.querySelector('[data-action="start-bot"], #startBot, .start-bot');
  const stopBtn  = document.querySelector('[data-action="stop-bot"], #stopBot, .stop-bot');
  function setState(running){ if(startBtn) startBtn.disabled = !!running; if(stopBtn) stopBtn.disabled = !running; }
  if(startBtn){ startBtn.addEventListener('click', async ()=>{ try{ await SWAT.start(); setState(true);}catch(e){ alert('Start failed'); } }); }
  if(stopBtn){  stopBtn.addEventListener('click', async ()=>{ try{ await SWAT.stop();  setState(false);}catch(e){ alert('Stop failed'); } }); }
  SWAT.status().then(s=>setState(s.running)).catch(()=>{});
})();
</script>`;

function injectHelpers(html){ if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, helperJs + '</body>'); return html + helperJs; }

function parseBody(req){ return new Promise((resolve)=>{ let d=''; req.on('data',c=>d+=c); req.on('end',()=>resolve(d)); }); }
function setSecurityHeaders(res){ res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Permissions-Policy','interest-cohort=()'); res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:"); }
function sendHtml(res, html){ setSecurityHeaders(res); res.writeHead(200, {'Content-Type':'text/html'}); res.end(html); }
function sendJson(res, obj){ setSecurityHeaders(res); res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(obj)); }
function isAuthed(req){ const cookies = parseCookies(req.headers.cookie || ''); const token = cookies['dash_auth']; const payload = verifySession(token, SECRET); return !!payload; }

const handler = async (req, res) => {
  try {
    if (req.method==='GET' && (req.url==='/' || req.url==='/index.html')){
      if (!isAuthed(req)) return sendHtml(res, loginHtml.replace('__ERROR__',''));
      return sendHtml(res, injectHelpers(indexHtml));
    }
    if (req.method==='GET' && req.url==='/settings'){
      if (!isAuthed(req)) return sendHtml(res, loginHtml.replace('__ERROR__',''));
      return sendHtml(res, injectHelpers(settingsHtml));
    }
    if (req.method==='POST' && req.url==='/login'){
      const body=await parseBody(req); const params=Object.fromEntries(new URLSearchParams(body));
      const u=(params.username||'').trim(); const p=(params.password||''); const users=loadUsersFromEnv();
      if (!u||!p||!users[u]||users[u]!==p) return sendHtml(res, loginHtml.replace('__ERROR__','Invalid credentials'));
      const token=signSession(u, SECRET); res.setHeader('Set-Cookie', `dash_auth=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax`); res.writeHead(302,{Location:'/'}); return res.end();
    }
    if (req.method==='GET' && req.url==='/logout'){ res.setHeader('Set-Cookie','dash_auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax'); res.writeHead(302,{Location:'/'}); return res.end(); }

    if (!isAuthed(req)) { res.writeHead(401); return res.end('Unauthorized'); }

    if (req.method==='GET' && req.url==='/api/status'){ return sendJson(res, { running: worker.isRunning(), stats: getStats() }); }
    if (req.method==='POST' && req.url==='/api/start'){ return sendJson(res, worker.start()); }
    if (req.method==='POST' && req.url==='/api/stop'){ return sendJson(res, worker.stop()); }
    if (req.method==='GET' && req.url==='/api/metrics'){ return sendJson(res, getStats()); }

    if (req.method==='GET' && req.url.startsWith('/api/logs')){
      const u = new URL(req.url, 'http://x'); const limit = Math.max(1, Math.min(1000, parseInt(u.searchParams.get('limit')||'200',10)));
      const rows = getBuffer().slice(-limit);
      return sendJson(res, { rows });
    }

    res.writeHead(404); res.end('Not Found');
  } catch (e) { res.writeHead(500); res.end('Server Error'); }
};

const server = http.createServer(handler);
const wss = new WebSocket.Server({ server }); attachWsServer(wss, (req)=> isAuthed(req));
server.listen(PORT, HOST, ()=> console.log(`[dashboard] listening on http://${HOST}:${PORT}`));
module.exports = server;
