// evmRouters.js
const { ethers } = require('ethers');
const { quoteBaseSwap } = require('./baseSwapRouters');
const { quoteUniV3, quoteUniV2 } = require('./onchainRouters');
const log = require('./logger');

function parseList(s){ return String(s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean); }

async function fanoutQuotes(chain, chainId, sellToken, buyToken, sellAmount){
  console.log(`[quotes] Getting quotes for ${sellToken} -> ${buyToken}`);
  console.log(`[quotes] Amount: ${ethers.formatEther(sellAmount)} WETH`);

  const wanted = parseList(process.env.ONCHAIN_ROUTERS || 'baseswap');
  const aliases = {
    base: 'baseswap',
    baseswap: 'baseswap',
    uni: 'univ3',
    uniswapv3: 'univ3',
    v3: 'univ3',
    univ3: 'univ3',
    v2: 'univ2',
    univ2: 'univ2'
  };

  const outs = [];
  for (const raw of wanted){
    const r = aliases[raw] || raw;
    try{
      if (r === 'baseswap'){
        const q = await quoteBaseSwap(sellToken, buyToken, sellAmount);
        if (q) outs.push({ ...q, router: 'baseswap' });
      } else if (r === 'univ3'){
        const fees = (process.env.UNI_V3_FEE_LIST || '500,3000,10000')
          .split(',').map(s=>parseInt(s.trim(),10)).filter(Boolean);
        for (const fee of fees){
          try{
            const q = await quoteUniV3(sellToken, buyToken, fee, sellAmount);
            if (q) outs.push({ ...q, router: 'univ3', fee });
          }catch(e){
            log.warn('fail', { router:`univ3:${fee}`, pair:`${sellToken}/${buyToken}`, msg: e.message || String(e) });
          }
        }
      } else if (r === 'univ2'){
        const q = await quoteUniV2(sellToken, buyToken, sellAmount);
        if (q) outs.push({ ...q, router: 'univ2' });
      } else {
        log.warn('Unsupported router', { router: raw });
      }
    } catch (e){
      log.warn('fail', { router: r, pair: `${sellToken}/${buyToken}`, msg: e.shortMessage || e.message || String(e) });
    }
  }

  console.log(`[quotes] Got ${outs.length} quotes`);
  return outs;
}

module.exports = { fanoutQuotes };
