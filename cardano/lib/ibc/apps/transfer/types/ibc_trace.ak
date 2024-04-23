use aiken/list
use ibc/core/ics_004/types/keys as chan_keys_mod
use ibc/core/ics_024_host_requirements/validate as validate_mod
use ibc/utils/string.{slash_char}

pub fn validate_prefixed_denom(denom: ByteArray) -> Bool {
  let denom_split = string.split(denom, slash_char)

  if denom_split == [denom] && string.trim_space(denom) != "" {
    True
  } else {
    expect Some(base) = list.last(denom_split)
    if string.trim_space(base) == "" {
      False
    } else {
      let paths =
        list.foldl(
          denom_split,
          ([], "", False, 0),
          fn(identifier, acc) {
            if acc.3rd {
              // broken
              acc
            } else {
              if acc.4th % 2 == 0 {
                (acc.1st, identifier, False, acc.4th + 1)
              } else {
                if chan_keys_mod.is_valid_channel_id(identifier) {
                  // valid channel_id => add ids to result
                  ([acc.2nd, identifier, ..acc.1st], "", False, acc.4th + 1)
                } else {
                  // invalid channel id => break
                  (acc.1st, "", True, acc.4th + 1)
                }
              }
            }
          },
        )
      let paths = paths.1st

      if list.all(paths, fn(p) { p == "" }) {
        True
      } else {
        let paths_len = list.length(paths)

        if paths_len % 2 != 0 {
          False
        } else {
          list.indexed_foldr(
            paths,
            True,
            fn(index, identifier, result) {
              result && if index % 2 == 0 {
                validate_mod.port_identifier_validator(identifier)
              } else {
                validate_mod.channel_identifier_validator(identifier)
              }
            },
          )
        }
      }
    }
  }
}

test test_validate_prefixed_denom() {
  let test_cases =
    [
      ("transfer/channel-1/uatom", True),
      ("transfer/channel-1/gamm/pool/1", True),
      ("/uatom", True),
      ("//uatom", True),
      ("uatom", True),
      ("erc20/0x85bcBCd7e79Ec36f4fBBDc54F90C643d921151AA", True),
      ("gamm/pool/1", True),
      ("(transfer)/channel-1/uatom", False),
      ("", False),
      ("transfer/", False),
    ]

  list.all(test_cases, fn(tc) { validate_prefixed_denom(tc.1st) == tc.2nd })
}
