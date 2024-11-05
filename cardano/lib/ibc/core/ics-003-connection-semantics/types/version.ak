use aiken/collection/list
use ibc/utils/string

pub type Version {
  identifier: ByteArray,
  features: List<ByteArray>,
}

pub const default_ibc_version_identifier = "1"

pub fn get_supported_orderings() -> List<ByteArray> {
  ["ORDER_ORDERED", "ORDER_UNORDERED"]
}

pub fn get_default_ibc_version() -> Version {
  new_version(default_ibc_version_identifier, get_supported_orderings())
}

pub fn new_version(identifier: ByteArray, features: List<ByteArray>) -> Version {
  Version { identifier, features }
}

/// validate_version does basic validation of the version identifier and features.
pub fn validate_version(version: Version) -> Bool {
  and {
    string.trim_space(version.identifier) != "",
    version.features
      |> list.all(fn(feature) { string.trim_space(feature) != "" }),
  }
}

/// get_compatible_versions returns a descending ordered set of compatible IBC
/// versions for the caller chain's connection end. The latest supported
/// version should be first element and the set should descend to the oldest
/// supported version.
pub fn get_compatible_versions() -> List<Version> {
  [get_default_ibc_version()]
}

/// is_supported_version returns true if the proposed version has a matching version
/// identifier and its entire feature set is supported or the version identifier
/// supports an empty feature set.
pub fn is_supported_version(
  supported_versions: List<Version>,
  proposed_version: Version,
) -> Bool {
  expect Some(supported_version) =
    supported_versions
      |> list.find(fn(ver) { ver.identifier == proposed_version.identifier })

  supported_version |> verify_proposed_version(proposed_version)
}

/// verify_proposed_version verifies that the entire feature set in the
/// proposed version is supported by this chain. If the feature set is
/// empty it verifies that this is allowed for the specified version
/// identifier.
pub fn verify_proposed_version(
  version: Version,
  proposed_version: Version,
) -> Bool {
  and {
    version.identifier == proposed_version.identifier,
    list.length(proposed_version.features) > 0 || allow_nil_feature_set(
      proposed_version.identifier,
    ),
    proposed_version.features
      |> list.all(fn(feature) { version.features |> list.has(feature) }),
  }
}

/// allow_nil_feature_set is a helper map to indicate if a specified version
/// identifier is allowed to have a nil feature set. Any versions supported,
/// but not included in the map default to not supporting nil feature sets.
fn allow_nil_feature_set(_identifier: ByteArray) -> Bool {
  False
}

/// verify_supported_feature takes in a version and feature string and returns
/// true if the feature is supported by the version and false otherwise.
pub fn verify_supported_feature(version: Version, feature: ByteArray) -> Bool {
  list.has(version.features, feature)
}
