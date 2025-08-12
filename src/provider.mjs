import { JsonRpcProvider } from "ethers";

// Network-pinned provider to avoid "failed to detect network"
export function getProvider(rpcUrl) {
  const network = { chainId: 8453, name: "base" };
  const p = new JsonRpcProvider(rpcUrl, network);
  // Optionally preflight a network call:
  // (Do not await here; leave to caller if they want to verify connectivity)
  return p;
}
