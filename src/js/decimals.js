
import { Contract } from "ethers";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Lowercased keys
const DEC_OVERRIDES = new Map([
  // WETH
  ["0x4200000000000000000000000000000000000006", 18],
  // USDC (native)
  ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 6],
  // USDbC (bridged)
  ["0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", 6],
  // axlUSDC
  ["0xeb466342c4d449bc9f53a865d5cb90586f405215", 6],
]);

/**
 * Safe decimals fetch with overrides and USD heuristic
 * @param {string} token
 * @param {import('ethers').Provider} provider
 * @returns {Promise<number>}
 */
export async function getDecimals(token, provider) {
  const k = token.toLowerCase();
  if (DEC_OVERRIDES.has(k)) return DEC_OVERRIDES.get(k);

  const c = new Contract(token, ERC20_ABI, provider);
  try {
    const dec = await c.decimals();
    if (typeof dec === "bigint") return Number(dec);
    return dec;
  } catch {}

  // Try symbol -> USD heuristic
  try {
    const s = (await c.symbol())?.toString?.().toUpperCase?.() ?? "";
    if (s.includes("USD")) return 6;
  } catch {}

  throw new Error(`getDecimals: decimals() failed and no override for ${token}`);
}

export { DEC_OVERRIDES };
