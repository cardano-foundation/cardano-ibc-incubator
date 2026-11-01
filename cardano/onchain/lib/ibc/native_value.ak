use aiken/builtin
use cardano/assets

// Transaction Values keep their V3 nested-map encoding. Convert once before
// performing several native operations on the same Value.
pub fn from_assets(value: assets.Value) -> Value {
  let raw: Data = assets.to_dict(value)
  builtin.un_value_data(raw)
}

pub fn quantity_of(
  value: assets.Value,
  policy: ByteArray,
  name: ByteArray,
) -> Int {
  builtin.lookup_value(policy, name, from_assets(value))
}

// Keep zero dynamic because the pinned Scalus decoder rejects native Value constants.
pub fn zero(value: Value) -> Value {
  builtin.scale_value(0, value)
}

pub fn add(
  value: Value,
  policy: ByteArray,
  name: ByteArray,
  amount: Int,
) -> Value {
  builtin.insert_value(
    policy,
    name,
    builtin.lookup_value(policy, name, value) + amount,
    value,
  )
}

pub fn match(left: Value, right: Value) -> Bool {
  builtin.value_data(builtin.insert_value(#"", #"", 0, left)) == builtin.value_data(
    builtin.insert_value(#"", #"", 0, right),
  )
}
