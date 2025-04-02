use aiken/collection/list
use ibc/utils/string.{
  hex_string_to_bytes, is_only_space, is_uint_string, slash_char, split,
  trim_space,
}

test test_trim_space() {
  and {
    trim_space("") == "",
    trim_space("             ") == "",
    trim_space("   abc") == "abc",
    trim_space("abc    ") == "abc",
    trim_space("    abc    ") == "abc",
    trim_space("    a   b  cd    ") == "a   b  cd",
  }
}

test test_split() {
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

  list.all(test_cases, fn(case) { split(case.1st, slash_char) == case.2nd })
}

test test_hex_string_to_bytes() {
  let test_cases = [("abcd1234", Some(#"abcd1234")), ("123x", None)]
  list.all(test_cases, fn(case) { hex_string_to_bytes(case.1st) == case.2nd })
}

test test_is_int_string() {
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
  list.all(test_cases, fn(case) { is_uint_string(case.1st) == case.2nd })
}

test trim_space_and_is_only_space_empty_string() {
  let empty_string = ""
  trim_space(empty_string) == "" && is_only_space(empty_string)
}

test trim_space_and_is_only_space_non_empty_string() {
  let non_empty_string = "lorem ipsum"
  trim_space(non_empty_string) != "" && !is_only_space(non_empty_string)
}

test trim_space_and_is_only_space_non_empty_string_with_spaces() {
  let non_empty_string = " lorem ipsum "
  trim_space(non_empty_string) != "" && !is_only_space(non_empty_string)
}

test trim_space_and_is_only_space_blank_string() {
  let blank_string = " "
  trim_space(blank_string) == "" && is_only_space(blank_string)
}

test is_only_space_succeed_empty_string() {
  is_only_space("")
}
