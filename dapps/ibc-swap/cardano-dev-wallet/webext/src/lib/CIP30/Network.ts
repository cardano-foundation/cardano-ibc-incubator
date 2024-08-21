enum NetworkId {
  Mainnet = 1,
  Testnet = 0,
}

enum NetworkName {
  Mainnet = "mainnet",
  Preprod = "preprod",
  Preview = "preview",
}

function networkNameToId(networkName: NetworkName): NetworkId {
  switch (networkName) {
    case NetworkName.Mainnet:
      return NetworkId.Mainnet;
    case NetworkName.Preprod:
      return NetworkId.Testnet;
    case NetworkName.Preview:
      return NetworkId.Testnet;
  }
}


export { NetworkId, NetworkName, networkNameToId };
