use aiken/collection/list
use ibc/client/ics_007_tendermint_client/height.{Height}

test test_zero_height() {
  height.zero_height() == Height { revision_number: 0, revision_height: 0 }
}

test test_compare_heights() {
  let test_cases: List<(Height, Height, Ordering)> =
    [
      // revision number 1 is lesser
      (
        Height { revision_number: 1, revision_height: 99 },
        Height { revision_number: 2, revision_height: 1 },
        Less,
      ),
      // revision number 1 is greater
      (
        Height { revision_number: 22, revision_height: 5 },
        Height { revision_number: 2, revision_height: 5 },
        Greater,
      ),
      // revision height 1 is lesser
      (
        Height { revision_number: 3, revision_height: 4 },
        Height { revision_number: 3, revision_height: 9 },
        Less,
      ),
      // revision height 1 is greater
      (
        Height { revision_number: 4, revision_height: 8 },
        Height { revision_number: 4, revision_height: 4 },
        Greater,
      ),
      // height is equal
      (
        Height { revision_number: 8, revision_height: 8 },
        Height { revision_number: 8, revision_height: 8 },
        Equal,
      ),
    ]

  test_cases
    |> list.all(fn(case) { height.compare(case.1st, case.2nd) == case.3rd })
}

test test_new_height() {
  height.new_height(2, 4) == Height { revision_number: 2, revision_height: 4 }
}

test test_is_valid() {
  let test_cases: List<(Height, Bool)> =
    [
      // revision_number < 0
      (Height { revision_number: -1, revision_height: 8 }, False),
      // revision_height < 0
      (Height { revision_number: 4, revision_height: -4 }, False),
      // revision_number < 0 and revision_height < 0
      (Height { revision_number: -6, revision_height: -8 }, False),
      // revision_height == 0 and revision_height == 0
      (Height { revision_number: 0, revision_height: 0 }, True),
      // revision_height > 0 and revision_height > 0
      (Height { revision_number: 3, revision_height: 5 }, True),
    ]

  test_cases |> list.all(fn(case) { height.is_valid(case.1st) == case.2nd })
}

test test_is_zero() {
  height.is_zero(Height { revision_number: 0, revision_height: 0 })
}

test test_parse_chain_id() {
  height.parse_chain_id("ogmosis") == 0
}
