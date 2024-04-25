use aiken/list
use aiken/transaction.{NoDatum, Output}
use aiken/transaction/credential
use aiken/transaction/value.{MintedValue}
use ibc/auth.{AuthToken}

test test_contain_auth_token() {
  let hash_sample =
    #"a4a054a554354a85a54a054a554354a854a054a554a054a554a054a554a054a5"
  let mock_policy_id = #"786a02f742015903c6c6fd852552d272912f4740e1584761"
  let mock_asset_name = "handler"

  let mock_valid_auth_token =
    AuthToken { policy_id: mock_policy_id, name: mock_asset_name }
  let mock_invalid_auth_token =
    AuthToken { policy_id: mock_policy_id, name: "any" }
  let mock_valid_output =
    Output {
      address: credential.from_script(hash_sample),
      value: value.from_asset(mock_policy_id, mock_asset_name, 1),
      datum: NoDatum,
      reference_script: None,
    }
  let mock_invalid_output =
    Output {
      address: credential.from_script(hash_sample),
      value: value.zero(),
      datum: NoDatum,
      reference_script: None,
    }

  let test_cases: List<(Output, AuthToken, Bool)> =
    [
      (mock_valid_output, mock_valid_auth_token, True),
      (mock_valid_output, mock_invalid_auth_token, False),
      (mock_invalid_output, mock_valid_auth_token, False),
    ]

  test_cases
    |> list.all(
        fn(case) { auth.contain_auth_token(case.1st, case.2nd) == case.3rd },
      )
}

test test_generate_token_name() {
  //1st: AuthToken
  //2nd: prefix
  //3rd: sequence
  //4th: expected token name
  let test_cases: List<(AuthToken, ByteArray, Int, ByteArray)> =
    [
      (
        AuthToken {
          policy_id: #"ae402aa242a85d03dde0913882ec6cb0f36edec61ccd501692de1472",
          //fromText(handler)
          name: #"68616e646c6572",
        },
        //fromText("ibc_client")
        #"6962635f636c69656e74",
        0,
        #"94051031ba171ddc7783efe491f76b4d2f1ba640f2c9db6430",
      ),
      (
        AuthToken {
          policy_id: #"33fdf23b67344da3dbc0f3ba0544ea9c2a732c87a7836d459019b9a0",
          //fromText(handler2)
          name: #"68616e646c657231",
        },
        //fromText("connection")
        #"636f6e6e656374696f6e",
        1,
        #"db2f7e8cd6a8158ed3d3807abc09c1f7e866b57f19dd9b3031",
      ),
      (
        AuthToken {
          policy_id: #"3215d69061f35ce20e4e5ad65c0b1850e8f5903fe553e920a23dea83",
          //fromText(handler3)
          name: #"68616e646c657232",
        },
        //fromText("channel")
        #"6368616e6e656c",
        2,
        #"f3b58dc840a819f86dc3477508463d4c3141e119239b722032",
      ),
      (
        AuthToken {
          policy_id: #"715727869d7d08d80bd22c510a095c858ae8353ad4324fe66106405d",
          //fromText(handler4)
          name: #"68616e646c657233",
        },
        //fromText("package")
        #"7061636b616765",
        3,
        #"ce71a7ad3269dd1796020cd46744571e7e086bf427b1b82e33",
      ),
    ]
  test_cases
    |> list.all(
        fn(case) {
          auth.generate_token_name(case.1st, case.2nd, case.3rd) == case.4th
        },
      )
}

test test_generate_token_name_from_another() {
  let test_cases: List<(ByteArray, ByteArray, Int, ByteArray)> =
    [
      (
        #"3f334ddd52c8f52f0ada7cce104ba1ba315cf0929ba0640b30",
        //fromText("ibc_client")
        #"6962635f636c69656e74",
        0,
        #"3f334ddd52c8f52f0ada7cce104ba1ba315cf092f2c9db6430",
      ),
      (
        #"3f334ddd52c8f52f0ada7cce104ba1ba315cf0929ba0640b30",
        //fromText("connection")
        #"636f6e6e656374696f6e",
        1,
        #"3f334ddd52c8f52f0ada7cce104ba1ba315cf09219dd9b3031",
      ),
      (
        #"db2f7e8cd6a8158ed3d3807abc09c1f7e866b57f19dd9b3031",
        //fromText("channel")
        #"6368616e6e656c",
        2,
        #"db2f7e8cd6a8158ed3d3807abc09c1f7e866b57f239b722032",
      ),
      (
        #"db2f7e8cd6a8158ed3d3807abc09c1f7e866b57f19dd9b3031",
        //fromText("package")
        #"7061636b616765",
        3,
        #"db2f7e8cd6a8158ed3d3807abc09c1f7e866b57f27b1b82e33",
      ),
    ]
  test_cases
    |> list.all(
        fn(case) {
          auth.generate_token_name_from_another(case.1st, case.2nd, case.3rd) == case.4th
        },
      )
}

test test_extract_token_base() {
  let test_cases: List<(ByteArray, ByteArray)> =
    [
      (
        #"3f334ddd52c8f52f0ada7cce104ba1ba315cf0929ba0640b30",
        //take 20 first bytes
        #"3f334ddd52c8f52f0ada7cce104ba1ba315cf092",
      ),
      (
        #"db2f7e8cd6a8158ed3d3807abc09c1f7e866b57f19dd9b3031",
        #"db2f7e8cd6a8158ed3d3807abc09c1f7e866b57f",
      ),
      (
        #"f3b58dc840a819f86dc3477508463d4c3141e119239b722032",
        #"f3b58dc840a819f86dc3477508463d4c3141e119",
      ),
      (
        #"ce71a7ad3269dd1796020cd46744571e7e086bf427b1b82e33",
        #"ce71a7ad3269dd1796020cd46744571e7e086bf4",
      ),
    ]
  test_cases
    |> list.all(fn(case) { auth.extract_token_base(case.1st) == case.2nd })
}

test test_extract_token_prefix() {
  let test_cases: List<(ByteArray, ByteArray)> =
    [
      (
        #"3f334ddd52c8f52f0ada7cce104ba1ba315cf0929ba0640b30",
        //take 20 to 23
        #"9ba0640b",
      ),
      (#"db2f7e8cd6a8158ed3d3807abc09c1f7e866b57f19dd9b3031", #"19dd9b30"),
      (#"f3b58dc840a819f86dc3477508463d4c3141e119239b722032", #"239b7220"),
      (#"ce71a7ad3269dd1796020cd46744571e7e086bf427b1b82e33", #"27b1b82e"),
    ]
  test_cases
    |> list.all(fn(case) { auth.extract_token_prefix(case.1st) == case.2nd })
}

test test_extract_token_sequence() {
  let test_cases: List<(ByteArray, Option<ByteArray>)> =
    [
      (
        // length <= 24
        #"3f334ddd52c8f52f0ada7cce104ba1ba315cf0929ba0640b",
        None,
      ),
      (#"f3b58dc840a819f86dc3477508463d4c3141e119239b722032", Some(#"32")),
      (#"ce71a7ad3269dd1796020cd46744571e7e086bf427b1b82e33", Some(#"33")),
    ]
  test_cases
    |> list.all(fn(case) { auth.extract_token_sequence(case.1st) == case.2nd })
}

//===================================mint_auth_token==================================
fn setup_mint_auth_token() -> (AuthToken, MintedValue) {
  let token = AuthToken { policy_id: "mock policy_id", name: "mock name" }

  let mint =
    value.from_asset(token.policy_id, token.name, 1) |> value.to_minted_value()

  (token, mint)
}

test mint_auth_token_succeed() {
  let (token, mint) = setup_mint_auth_token()

  auth.mint_auth_token(mint, token)
}

test mint_auth_token_fail() fail {
  let (token, mint) = setup_mint_auth_token()

  let mint =
    mint
      |> value.from_minted_value()
      |> value.add(token.policy_id, token.name, 1)
      |> value.to_minted_value()

  auth.mint_auth_token(mint, token)
}
