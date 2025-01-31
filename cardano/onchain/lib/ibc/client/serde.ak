pub fn marshal(value_opt: Option<a>, f: fn(a) -> ByteArray) -> ByteArray {
  when value_opt is {
    Some(a) -> f(a)
    None -> #""
  }
}

pub fn size(value_opt: Option<a>, f: fn(a) -> Int) -> Int {
  when value_opt is {
    Some(a) -> f(a)
    None -> 0
  }
}
