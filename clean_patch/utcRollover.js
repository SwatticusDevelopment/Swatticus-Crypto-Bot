// utcRollover.js
function nextDelayMs() {
  const n = new Date();
  const t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()+1, 0,0,10));
  return t.getTime() - n.getTime();
}
function scheduleDaily(task) {
  let timer = null;
  const arm = () => {
    timer = setTimeout(async () => { try { await task(); } catch {} arm(); }, nextDelayMs());
  };
  arm();
  return () => clearTimeout(timer);
}
module.exports = { scheduleDaily };
