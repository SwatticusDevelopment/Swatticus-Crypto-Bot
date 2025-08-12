import { JsonRpcProvider, WebSocketProvider, FallbackProvider } from 'ethers';

const network = { name: 'base', chainId: 8453 };

const http = new JsonRpcProvider(process.env.RPC_URL, network);
http.pollingInterval = Number(process.env.POLL_MS ?? 1500);

let providers = [http];

if (process.env.WS_URL) {
  try {
    const ws = new WebSocketProvider(process.env.WS_URL, network);
    providers = [ws, http];
  } catch (e) {
    // ignore WS init errors; we'll just use HTTP
  }
}

export const provider = providers.length > 1 ? new FallbackProvider(providers) : http;