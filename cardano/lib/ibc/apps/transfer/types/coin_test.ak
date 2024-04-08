use aiken/list
use ibc/apps/transfer/types/coin as coin_mod

test test_sender_chain_is_source() {
  let test_cases =
    [
      (("port-0", "channel-0", "port-0/channel-0/usdt"), False),
      (
        ("port-0", "channel-0", "port-0/channel-0/port-11/channel-23/usdt"),
        False,
      ),
      (("port-0", "channel-0", "usdt"), True),
      (("port-0", "channel-0", "port-12/channel-99/usdt"), True),
    ]

  list.all(
    test_cases,
    fn(tc) {
      coin_mod.sender_chain_is_source(tc.1st.1st, tc.1st.2nd, tc.1st.3rd) == tc.2nd
    },
  )
}

test test_receiver_chain_is_source() {
  let test_cases =
    [
      (("port-1", "channel-1", "port-1/channel-1/usdt"), True),
      (
        ("port-1", "channel-1", "port-1/channel-1/port-11/channel-23/usdt"),
        True,
      ),
      (("port-99", "channel-99", "usdt"), False),
      (("port-999", "channel-999", "port-12/channel-99/usdt"), False),
    ]

  list.all(
    test_cases,
    fn(tc) {
      coin_mod.receiver_chain_is_source(tc.1st.1st, tc.1st.2nd, tc.1st.3rd) == tc.2nd
    },
  )
}

test test_get_denom_prefix() {
  coin_mod.get_denom_prefix("port-993", "channel-324") == "port-993/channel-324/"
}
