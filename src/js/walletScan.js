// src/js/walletScan.js
// Discover all ERC-20 token contracts the wallet has interacted with by scanning Transfer logs.
// Works without any explorer API. It paginates chain logs in small block ranges to respect RPC limits.
//
const { ethers } = require('ethers');

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

function toBlockNum(x){ return (typeof x === 'bigint') ? x : BigInt(x); }
function topicFor(addr){
  try { return ethers.zeroPadValue(ethers.getAddress(addr), 32); } catch { return null; }
}

/**
 * discoverWalletTokens
 * @param {ethers.Provider} provider
 * @param {string} wallet - hex address (checksummed or lower OK)
 * @param {bigint|number|string} fromBlock - first block to search (inclusive)
 * @param {bigint|number|string} toBlock   - last  block to search (inclusive)
 * @param {number} step - block span per request (keep small; some RPCs enforce ~500)
 * @returns {Promise<Set<string>>} unique token addresses
 */
async function discoverWalletTokens(provider, wallet, fromBlock, toBlock, step=500){
  const addrTopic = topicFor(wallet);
  if (!addrTopic) throw new Error('Invalid wallet address for topic');

  let start = toBlockNum(fromBlock);
  const end = toBlockNum(toBlock);
  const span = BigInt(step);

  const set = new Set();

  while (start <= end){
    const chunkEnd = (start + span > end) ? end : (start + span);
    // outgoing (from = wallet)
    try {
      const logsOut = await provider.getLogs({
        fromBlock: start,
        toBlock: chunkEnd,
        topics: [TRANSFER_TOPIC, addrTopic]  // topic1 = from
      });
      for (const lg of logsOut){ if (lg?.address) set.add(ethers.getAddress(lg.address)); }
    } catch (e) {
      // ignore; continue
    }
    // incoming (to = wallet)
    try {
      const logsIn = await provider.getLogs({
        fromBlock: start,
        toBlock: chunkEnd,
        topics: [TRANSFER_TOPIC, null, addrTopic]  // topic2 = to
      });
      for (const lg of logsIn){ if (lg?.address) set.add(ethers.getAddress(lg.address)); }
    } catch (e) {
      // ignore; continue
    }

    start = chunkEnd + 1n;
  }
  return set;
}

module.exports = { discoverWalletTokens };
