// multiRouterExec.js
// Optional: central place to add execution for routers beyond 0x. Always loaded.
// By default, only 0x direct calldata is executed (see evmSwap.js). Others are no-ops until you add them.

function executeByRouter(router, payload, evmExec) {
  if (router === '0x') return evmExec(payload, '0x');
  // Stubs for other routers; return resolved result to avoid throwing
  if (router === '1inch')  return Promise.resolve({ success: false, txHash: '' });
  if (router === 'paraswap') return Promise.resolve({ success: false, txHash: '' });
  if (router === 'kyber')  return Promise.resolve({ success: false, txHash: '' });
  if (router === 'uniswap')return Promise.resolve({ success: false, txHash: '' });
  if (router === 'cow')    return Promise.resolve({ success: false, txHash: '' });
  return Promise.resolve({ success: false, txHash: '' });
}

module.exports = { executeByRouter };
