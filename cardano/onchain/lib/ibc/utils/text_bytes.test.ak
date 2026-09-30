use aiken/collection/list
use ibc/utils/text_bytes.{
  ascii_slash, is_canonical_unsigned_decimal, is_empty_or_ascii_spaces,
  split_on_ascii_byte, trim_ascii_spaces,
}

test test_trim_ascii_spaces() {
  and {
    trim_ascii_spaces("") == "",
    trim_ascii_spaces("             ") == "",
    trim_ascii_spaces("   abc") == "abc",
    trim_ascii_spaces("abc    ") == "abc",
    trim_ascii_spaces("    abc    ") == "abc",
    trim_ascii_spaces("    a   b  cd    ") == "a   b  cd",
  }
}

test test_split_on_ascii_byte() {
  let test_cases =
    [
      // Original test case
      ("port-0/channel-99/ibc/usdt", ["port-0", "channel-99", "ibc", "usdt"]),
      // Test case with an empty string
      ("", [""]),
      // Test case with a single element
      ("element", ["element"]),
      // Test case with consecutive slashes
      ("/first//second/", ["", "first", "", "second", ""]),
      // Test case with leading and trailing slashes
      ("/start/middle/end/", ["", "start", "middle", "end", ""]),
      // Test case with spaces
      ("space separated words", ["space separated words"]),
      // Test case with special characters
      ("special@characters#test", ["special@characters#test"]),
    ]

  list.all(
    test_cases,
    fn(case) { split_on_ascii_byte(case.1st, ascii_slash) == case.2nd },
  )
}

test canonical_unsigned_decimal_examples() {
  let test_cases =
    [
      // Valid unsigned integers
      ("1234", True),
      // Single-character string "0" is valid
      ("0", True),
      // Leading zeros are not allowed
      ("0123", False),
      // All-zero string is not valid
      ("00000", False),
      // Non-digit characters are not allowed
      ("abc", False),
      // Empty string is not valid
      ("", False),
      // Negative integers are not allowed
      ("-1", False),
      // Positive sign is not allowed
      ("+1", False),
      // Floating-point and scientific notation cases
      ("3.14", False),
      // Floating-point numbers are not allowed
      ("1e6", False),
    ]

  // Scientific notation is not allowed
  list.all(
    test_cases,
    fn(case) { is_canonical_unsigned_decimal(case.1st) == case.2nd },
  )
}

test ascii_space_checks_accept_empty_input() {
  let empty_string = ""
  trim_ascii_spaces(empty_string) == "" && is_empty_or_ascii_spaces(
    empty_string,
  )
}

test ascii_space_checks_reject_non_space_bytes() {
  let non_empty_string = "lorem ipsum"
  trim_ascii_spaces(non_empty_string) != "" && !is_empty_or_ascii_spaces(
    non_empty_string,
  )
}

test ascii_space_checks_reject_text_with_outer_spaces() {
  let non_empty_string = " lorem ipsum "
  trim_ascii_spaces(non_empty_string) != "" && !is_empty_or_ascii_spaces(
    non_empty_string,
  )
}

test ascii_space_checks_accept_spaces() {
  let blank_string = " "
  trim_ascii_spaces(blank_string) == "" && is_empty_or_ascii_spaces(
    blank_string,
  )
}

test empty_input_is_empty_or_ascii_spaces() {
  is_empty_or_ascii_spaces("")
}
