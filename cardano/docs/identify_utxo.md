# Identify UTXOs of IBC Cardano

In Cardano's eUTXO model, the states of a DApp are stored in the datum of UTXOs. If our DApp is small and its entire state can be stored in a single UTXO, it is straightforward to look up the UTXO using its output reference (transaction hash and output index). However, for Cardano IBC, the states are large and distributed across multiple UTXOs, necessitating an effective way to identify which UTXOs belong to our system.

One option is to use the address of the UTXOs, but in Cardano, anyone can create a UTXO with arbitrary data and attach it to a specific address. Because of this, using addresses alone is not sufficient. Instead, we can use a type of validator script in Cardano called a minting policy to manage the authenticity of UTXOs.

Minting policies ensure authenticity in our application by validating transactions that create new UTXOs and only minting tokens if these transactions are valid. We can later look up UTXOs that contain tokens minted by our minting policy to identify the UTXOs of our system.

## Handler Identity Token

Unlike other objects in IBC (client, connection), a handler usually has only one instance per chain. So we need a way to ensure the handler token is only minted once. There are many ways to achieve this, here we use a UTXO reference as a nonce, pass it to the parameter of the mint handler validator script, and then require it in the inputs of the transaction. With this approach, each time we create a handler and mint a new identity token for it, the token is guaranteed to be unique. You can see the code snippet demonstrating this idea below:

```aiken
validator(
  utxo_ref: OutputReference,
  update_handler_script_hash: Hash<Blake2b_224, Script>,
) {
  fn mint_handler(_redeemer: Void, context: ScriptContext) -> Bool {
    
    // ... other logic

    expect inputs |> list.any(fn(input) { input.output_reference == utxo_ref })

    // ... other logic


  }
}
```

Since the minting policy id (extract from hash of minting policy) is already unique, the name of token can be any, here we use a fixed constant `handler` for it. So the whole token unit of handler is calculated with this formula:

```
handler_token_unit = handler_minting_policy_id + to_bytes("handler")
```

## Other Entities Identity Token

Based on the unique identity of the handler, we can easily generate other tokens for identifying the rest of the entities. Because the minting policy of the handler depends on the validator script of the others, we are unable to directly pass the handler token to the validator scripts' parameters. Instead, we can pass the handler token to the name of their identity tokens. So, the token names can be calculated as follows:

```
client_identity_token = sha3_256(handlerTokenUnit)[0:20] + sha3_256(toHex("ibc_client"))[0:4] + toHex(client_sequence.toString())

connection_identity_token = sha3_256(handlerTokenUnit)[0:20] + sha3_256(toHex("connection"))[0:4] + toHex(connection_sequence.toString())

channel_identity_token = sha3_256(handlerTokenUnit)[0:20] + sha3_256(toHex("channel"))[0:4] + toHex(channel_sequence.toString())

port_identity_token = sha3_256(handlerTokenUnit)[0:20] + sha3_256(toHex("port"))[0:4] + toHex(port_number.toString())

```

Although calculation process is a bit complicated, it ensures that all minted tokens belong to a specific handler instance. With it, not only off-chain services easily query and update UTXOs, but also on-chain validator scripts can identify and cross-refer each other.