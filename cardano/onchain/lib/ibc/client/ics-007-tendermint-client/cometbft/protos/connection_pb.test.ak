use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb.{
  ConnectionEnd, UNINITIALIZED, marshal_for_connection_end,
  marshal_for_counterparty, marshal_for_version,
}
use ibc/client/ics_007_tendermint_client/cometbft/protos/connection_pb_deprecated.{
  ConnectionEnd as ConnectionEndDeprecated,
  UNINITIALIZED as UNINITIALIZED_DEPRECATED,
  marshal_for_connection_end as marshal_for_connection_end_deprecated,
  marshal_for_counterparty as marshal_for_counterparty_deprecated,
  marshal_for_version as marshal_for_version_legacy,
  size_for_counterparty as size_for_counterparty_deprecated,
  size_for_version as size_for_version_legacy,
}
use ibc/core/ics_003_connection_semantics/types/counterparty.{new_counterparty}
use ibc/core/ics_003_connection_semantics/types/version.{Version}
use ibc/core/ics_023_vector_commitments/merkle_prefix.{MerklePrefix}

test marshal_for_version_produces_same_results() {
  let version = Version(#"0101", [#"0201", #"0202"])
  let (length, bytes) = marshal_for_version(version)
  let bytes_legacy = marshal_for_version_legacy(Some(version))
  let length_legacy = size_for_version_legacy(Some(version))
  bytes == bytes_legacy && length == length_legacy
}

test marshal_for_counerparty_produces_same_results() {
  let counterparty = new_counterparty(#"0301", #"0401", MerklePrefix(#"0501"))
  let (length, bytes) = marshal_for_counterparty(counterparty)
  let bytes_deprecated = marshal_for_counterparty_deprecated(Some(counterparty))
  let length_deprecated = size_for_counterparty_deprecated(Some(counterparty))
  bytes == bytes_deprecated && length == length_deprecated
}

test marshal_for_connection_end_produces_same_results() {
  let connection_end =
    ConnectionEnd(
      #"0001",
      [Version(#"0101", [#"0201", #"0202"])],
      UNINITIALIZED,
      new_counterparty(#"0301", #"0401", MerklePrefix(#"0501")),
      10,
    )
  let connection_end_deprecated =
    ConnectionEndDeprecated(
      #"0001",
      [Some(Version(#"0101", [#"0201", #"0202"]))],
      UNINITIALIZED_DEPRECATED,
      new_counterparty(#"0301", #"0401", MerklePrefix(#"0501")),
      10,
    )
  let bytes = marshal_for_connection_end(connection_end)
  let bytes_deprecated =
    marshal_for_connection_end_deprecated(Some(connection_end_deprecated))
  bytes == #"0a020001120c0a0201011202020112020202220e0a020301120204011a040a020501280a" && bytes == bytes_deprecated
}
