use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_upgrade_pb.{
  marshal_error_receipt, marshal_upgrade,
}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_004/types/order.{Ordered, Unordered}
use ibc/core/ics_004/types/upgrade.{
  ErrorReceipt, Upgrade, UpgradeFields, UpgradeTimeout,
}

// Expected bytes are ibc-go v8.7.0 `Marshal` output.

fn fields() -> UpgradeFields {
  UpgradeFields {
    ordering: Unordered,
    connection_hops: ["connection-1"],
    version: "ics20-1",
  }
}

fn timeout(revision_number: Int, revision_height: Int, timestamp: Int) {
  UpgradeTimeout {
    height: Height { revision_number, revision_height },
    timestamp,
  }
}

test initial_upgrade_matches_ibc_go() {
  marshal_upgrade(
    Upgrade {
      fields: fields(),
      timeout: timeout(0, 0, 0),
      next_sequence_send: 0,
    },
  ) == #"0a190801120c636f6e6e656374696f6e2d311a0769637332302d3112020a00"
}

test flushing_upgrade_matches_ibc_go() {
  marshal_upgrade(
    Upgrade {
      fields: fields(),
      timeout: timeout(0, 0, 1700000600000000000),
      next_sequence_send: 5,
    },
  ) == #"0a190801120c636f6e6e656374696f6e2d311a0769637332302d31120c0a001080e0cdc79eb1e7cb171805"
}

test upgrade_timeout_height_matches_ibc_go() {
  marshal_upgrade(
    Upgrade {
      fields: fields(),
      timeout: timeout(2, 500, 1700000600000000000),
      next_sequence_send: 5,
    },
  ) == #"0a190801120c636f6e6e656374696f6e2d311a0769637332302d3112110a05080210f4031080e0cdc79eb1e7cb171805"
}

test ordered_upgrade_without_version_matches_ibc_go() {
  marshal_upgrade(
    Upgrade {
      fields: UpgradeFields {
        ordering: Ordered,
        connection_hops: ["connection-1", "connection-2"],
        version: "",
      },
      timeout: timeout(0, 0, 0),
      next_sequence_send: 300,
    },
  ) == #"0a1e0802120c636f6e6e656374696f6e2d31120c636f6e6e656374696f6e2d3212020a0018ac02"
}

test error_receipt_matches_ibc_go() {
  marshal_error_receipt(
    ErrorReceipt {
      sequence: 7,
      message: "ABCI code: 28: restored channel to pre-upgrade state",
    },
  ) == #"080712344142434920636f64653a2032383a20726573746f726564206368616e6e656c20746f207072652d75706772616465207374617465"
}

test empty_error_receipt_matches_ibc_go() {
  marshal_error_receipt(ErrorReceipt { sequence: 0, message: "" }) == #""
}
