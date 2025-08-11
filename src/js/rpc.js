// src/js/rpc.js
import pLimit from 'p-limit';
import { getProvider, rotateProvider } from './provider.js';

const limit = pLimit(Number(process.env.RPC_CONCURRENCY || 6));

export async function rpc(fn, { retries = 5 } = {}) {
  return limit(async () => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn(getProvider());
      } catch (e) {
        const msg = String(e?.message || e);
        const transient =
          msg.includes('429') ||
          msg.includes('failed to detect network') ||
          msg.includes('missing revert data') ||
          msg.includes('could not coalesce error');

        if (!transient) throw e;

        // small backoff
        await new Promise(r => setTimeout(r, 250 * (i + 1)));

        // rotate RPC after a couple failed tries
        if (i === 2) rotateProvider();
      }
    }
    throw new Error('RPC failed after retries');
  });
}
