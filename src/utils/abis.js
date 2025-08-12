export const UNISWAP_V3_FACTORY = [
  {
    "inputs":[
      {"internalType":"address","name":"tokenA","type":"address"},
      {"internalType":"address","name":"tokenB","type":"address"},
      {"internalType":"uint24","name":"fee","type":"uint24"}
    ],
    "name":"getPool",
    "outputs":[{"internalType":"address","name":"pool","type":"address"}],
    "stateMutability":"view","type":"function"
  }
];

export const UNISWAP_V3_POOL = [
  {"inputs":[],"name":"slot0","outputs":[
    {"internalType":"uint160","name":"sqrtPriceX96","type":"uint160"},
    {"internalType":"int24","name":"tick","type":"int24"},
    {"internalType":"uint16","name":"observationIndex","type":"uint16"},
    {"internalType":"uint16","name":"observationCardinality","type":"uint16"},
    {"internalType":"uint16","name":"observationCardinalityNext","type":"uint16"},
    {"internalType":"uint8","name":"feeProtocol","type":"uint8"},
    {"internalType":"bool","name":"unlocked","type":"bool"}
  ],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"liquidity","outputs":[{"internalType":"uint128","name":"","type":"uint128"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"token0","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"token1","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"}
];

export const ERC20 = [
  {"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}
];