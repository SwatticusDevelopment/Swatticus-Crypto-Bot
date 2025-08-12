import { Interface } from "ethers";

const ERC20_IFACE = new Interface([
  "function decimals() view returns (uint8)"
]);

// Known overrides on Base (extend as needed)
const DEC_OVERRIDE = new Map([
  ["0x4200000000000000000000000000000000000006".toLowerCase(), 18], // WETH
  ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913".toLowerCase(), 6],  // USDC
]);

export async function safeDecimals(provider, token, fallback = 18) {
  const key = token.toLowerCase();
  if (DEC_OVERRIDE.has(key)) return DEC_OVERRIDE.get(key);

  try {
    const data = ERC20_IFACE.encodeFunctionData("decimals", []);
    const res = await provider.call({ to: token, data });
    if (!res || res === "0x") return fallback;
    const [dec] = ERC20_IFACE.decodeFunctionResult("decimals", res);
    const n = Number(dec);
    if (Number.isFinite(n) && n >= 0 && n <= 255) return n;
    return fallback;
  } catch {
    return fallback;
  }
}
