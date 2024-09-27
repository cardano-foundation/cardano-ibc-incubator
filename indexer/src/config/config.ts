export default {
  SideChainRpc: process.env.SUBQL_SIDE_CHAIN_RPC || "http://0.0.0.0:1317",
  LocalOsmosisRpc: process.env.SUBQL_LOCAL_OSMOSIS_RPC || "http://0.0.0.0:1318",
};
