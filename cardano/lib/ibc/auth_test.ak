use aiken/list
use aiken/transaction.{NoDatum, Output}
use aiken/transaction/credential
use aiken/transaction/value
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
