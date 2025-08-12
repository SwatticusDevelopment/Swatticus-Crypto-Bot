// src/utils/safeDecimals.mjs
import { Interface, Contract } from 'ethers';

// Hard overrides for tokens you know on Base
export const DECIMALS_OVERRIDE = {
  '0x4200000000000000000000000000000000000006': 18, // WETH
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,  // USDC
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 6,  // USDbC
  '0xeb466342c4d449bc9f53a865d5cb90586f405215': 6   // USDT
};

const ERC20_ABI = ['function decimals() view returns (uint8)'];

export async function safeDecimals(addr, provider) {
  const a = addr.toLowerCase();
  if (DECIMALS_OVERRIDE[a] != null) return DECIMALS_OVERRIDE[a];
  try {
    const erc20 = new Contract(addr, ERC20_ABI, provider);
    return import { safeDecimals } from './utils/safeDecimals.mjs';
// ...
const decimals = await safeDecimals(tokenAddress, provider);;
  } catch {
    return 18; // fallback
  }
}
