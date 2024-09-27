export default {
  SideChainRpc: process.env.SUBQL_SIDE_CHAIN_RPC || "http://34.250.140.20:1317",
  LocalOsmosisRpc:
    process.env.SUBQL_LOCAL_OSMOSIS_RPC || "http://63.33.19.209:1318",
};
