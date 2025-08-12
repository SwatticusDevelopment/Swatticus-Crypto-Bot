
export const UNISWAP_V3_FACTORY_BASE = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";

export const IUniswapV3FactoryAbi = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address)",
  "function poolInitCodeHash() external view returns (bytes32)",
];

export const IUniswapV3PoolAbi = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
];
