use chrono::{DateTime, NaiveDateTime, Utc};

pub type Date = DateTime<Utc>;

pub fn now() -> Date {
  Utc::now().into()
}

pub fn parse_from_str_to_timestamp(date_str: String) -> i64 {
  // Parse the date string into a DateTime object
  return NaiveDateTime::parse_from_str(&date_str, "%Y-%m-%d %H:%M:%S")
    .unwrap()
    .timestamp();
}
