
export class RateLimitError extends Error {
  constructor(message = "Rate limited") { super(message); this.name = "RateLimitError"; }
}

export class TransientRpcError extends Error {
  constructor(message = "Transient RPC error") { super(message); this.name = "TransientRpcError"; }
}

export function isRateLimit(e: any): boolean {
  if (!e) return false;
  const msg = String(e?.message || e);
  return e?.status === 429 || /rate.?limit|too many|exceeded.*capacity|compute units/i.test(msg);
}

export function isNetworkish(e: any): boolean {
  const msg = String(e?.message || e);
  return /ENET|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(msg);
}

export function isRouterWeirdRevert(e: any): boolean {
  const msg = String(e?.message || e);
  return /missing revert data|could not coalesce/i.test(msg);
}

export function isInsufficientLiquidity(e: any): boolean {
  const msg = String(e?.message || e);
  return /INSUFFICIENT_LIQUIDITY/i.test(msg);
}
