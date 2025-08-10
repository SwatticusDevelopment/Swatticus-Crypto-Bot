// flashbotsExec.js
// Optional: placeholder to integrate Flashbots/MEV-Blocker. Always loaded; no side effects by default.
// Implement your bundle send and replace wallet.sendTransaction when enabled.

const enabled = process.env.USE_FLASHBOTS === 'true';
if (enabled) {
  console.log('Flashbots execution enabled (wire your bundle sender here).');
}

module.exports = {};
