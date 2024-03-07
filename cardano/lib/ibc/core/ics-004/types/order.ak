/// Order defines if a channel is ORDERED or UNORDERED
pub type Order {
  /// zero-value for channel ordering
  None
  /// packets can be delivered in any order, which may differ from the order in which they were sent.
  Unordered
  /// packets are delivered exactly in the order which they were sent
  Ordered
}

pub fn string(order: Order) -> ByteArray {
  when order is {
    None -> "ORDER_NONE_UNSPECIFIED"
    Unordered -> "ORDER_UNORDERED"
    Ordered -> "ORDER_ORDERED"
  }
}
