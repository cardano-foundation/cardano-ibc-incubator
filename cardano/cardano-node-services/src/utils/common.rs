pub fn convert_string_to_u64(my_string: String) -> u64 {
  // Attempt to convert the string to a u64
  match my_string.parse::<u64>() {
    Ok(parsed_value) => {
      // Now you can use 'parsed_value' as a u64
      return parsed_value;
    }
    Err(e) => {
      println!("Failed to convert to u64: {}", e);
      return 0;
    }
  };
}
