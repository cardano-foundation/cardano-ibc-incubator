use aiken/collection/list
use ibc/core/ics_024_host_requirements/validate

test test_default_identifier_validator() {
  let test_cases =
    [
      // valid lowercase
      ("lowercaseid", True),
      // valid id special chars
      ("._+-#[]<>._+-#[]<>", True),
      // valid id lower and special chars
      ("lower._+-#[]<>", True),
      // numeric id
      ("1234567890", True),
      // uppercase id
      ("NOTLOWERCASE", True),
      // numeric id
      ("1234567890", True),
      // blank id
      ("               ", False),
      // id length out of range
      ("1", False),
      // id is too long
      ("this identifier is too long to be used as a valid identifier", False),
      // path-like id
      ("lower/case/id", False),
      // invalid id
      ("(clientid)", False),
      // empty string
      ("", False),
    ]

  test_cases
    |> list.all(
        fn(case) {
          and {
            validate.client_identifier_validator(case.1st) == case.2nd,
            validate.connection_identifier_validator(case.1st) == case.2nd,
            validate.channel_identifier_validator(case.1st) == case.2nd,
            validate.port_identifier_validator(case.1st) == case.2nd,
          }
        },
      )
}
