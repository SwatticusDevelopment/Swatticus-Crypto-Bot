// usdcRollover.js
// Optional: schedules a daily callback at 00:00:10 UTC. Always running.

function nextDelayMs() {
  const n = new Date();
  const t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()+1, 0, 0, 10));
  return t.getTime() - n.getTime();
}

function scheduleDaily(task) {
  let timer;
  const arm = () => {
    timer = setTimeout(async () => {
      try { await task(); } catch {}
      arm();
    }, nextDelayMs());
  };
  arm();
  return () => clearTimeout(timer);
}

// Default task is a no-op; replace with your consolidation function.
const noop = async () => {};

if (process.env.AUTO_USDC_ROLLOVER !== 'false') {
  scheduleDaily(noop);
}

module.exports = { scheduleDaily };
