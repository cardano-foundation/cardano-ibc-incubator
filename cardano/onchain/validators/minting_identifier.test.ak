use cardano/address.{Address, Script}
use cardano/assets.{from_asset}
use cardano/transaction.{Input, NoDatum, Output, OutputReference, Transaction}
use minting_identifier

test mints_identifier_from_nonce_output_reference() {
  let policy_id = #"a00f2bd1a9fa85e89a15583d60eb4890abb49e2a11aa1722d0fee1bb"
  let token_name =
    #"b3321868a44d5084bb59381c6f6d70f438742b67159bbc7fedfad4ae817ad43d"
  // The deployment flow derives the identifier token from this one-shot nonce input.
  let nonce_output_reference =
    OutputReference {
      transaction_id: #"e5e829ce860b1efa1d7ec207d3e8e588be604e8da7ee34ea71f177d7339bc217",
      output_index: 1,
    }
  // Spending the nonce input proves the identifier mint is tied to the expected output reference.
  let nonce_input =
    Input {
      output_reference: nonce_output_reference,
      output: Output {
        address: Address(
          Script(#"a78cb4bc908989d0c957e27cf5a10368fdf9feabab3f64707292d589"),
          None,
        ),
        value: from_asset(policy_id, token_name, 1),
        datum: NoDatum,
        reference_script: None,
      },
    }

  let transaction =
    Transaction {
      ..transaction.placeholder,
      inputs: [nonce_input],
      mint: from_asset(policy_id, token_name, 1),
    }

  // Regression guard for deployment-shaped identifier minting.
  minting_identifier.minting_identifier.mint(
    nonce_output_reference,
    policy_id,
    transaction,
  )
}
