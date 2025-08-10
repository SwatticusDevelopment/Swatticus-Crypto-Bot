// wsMempool.js
function startPending(provider, onHash) {
  try {
    provider.on('pending', (h) => { try { onHash && onHash(h); } catch {} });
    return () => provider.removeAllListeners('pending');
  } catch { return () => {}; }
}
module.exports = { startPending };
