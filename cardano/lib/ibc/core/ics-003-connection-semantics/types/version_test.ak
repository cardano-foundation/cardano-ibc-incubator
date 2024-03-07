use aiken/list
use ibc/core/ics_003_connection_semantics/types/version.{Version}

pub const default_ibc_version_identifier = "1"

test test_get_supported_orderings() {
  let supported_oderings =
    ["ORDER_ORDERED", "ORDER_UNORDERED"]
  version.get_supported_orderings() == supported_oderings
}

test test_get_default_ibc_version() {
  let supported_oderings =
    ["ORDER_ORDERED", "ORDER_UNORDERED"]
  version.get_default_ibc_version() == Version {
    identifier: default_ibc_version_identifier,
    features: supported_oderings,
  }
}

test test_new_version() {
  let supported_oderings =
    ["ORDER_ORDERED", "ORDER_UNORDERED"]
  version.new_version(default_ibc_version_identifier, supported_oderings) == Version {
    identifier: default_ibc_version_identifier,
    features: supported_oderings,
  }
}

test test_validate_version() {
  let supported_oderings =
    ["ORDER_ORDERED", "ORDER_UNORDERED"]
  let test_cases: List<(Version, Bool)> =
    [
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: supported_oderings,
        },
        True,
      ),
      (Version { identifier: "", features: supported_oderings }, False),
      (
        Version {
          identifier: "",
          features: supported_oderings |> list.push(""),
        },
        False,
      ),
    ]
  test_cases
    |> list.all(fn(case) { version.validate_version(case.1st) == case.2nd })
}

test test_get_compatible_versions() {
  let supported_oderings =
    ["ORDER_ORDERED", "ORDER_UNORDERED"]
  version.get_compatible_versions() == [
    Version {
      identifier: default_ibc_version_identifier,
      features: supported_oderings,
    },
  ]
}

test test_is_supported_version() {
  let test_cases: List<(List<Version>, Version, Bool)> =
    [
      (
        [
          Version {
            identifier: default_ibc_version_identifier,
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
          Version {
            identifier: "2",
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
        ],
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        True,
      ),
      (
        [
          Version {
            identifier: default_ibc_version_identifier,
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
        ],
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_UNORDERED", "ORDER_ORDERED"],
        },
        True,
      ),
      (
        [
          Version {
            identifier: default_ibc_version_identifier,
            features: ["ORDER_ORDERED", "ORDER_UNORDERED", "ORDER_MOCK"],
          },
        ],
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_UNORDERED", "ORDER_ORDERED"],
        },
        True,
      ),
      (
        [
          Version {
            identifier: default_ibc_version_identifier,
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
        ],
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED", "ORDER_MOCK"],
        },
        False,
      ),
      (
        [
          Version {
            identifier: default_ibc_version_identifier,
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
        ],
        Version { identifier: default_ibc_version_identifier, features: [] },
        False,
      ),
    ]
  test_cases
    |> list.all(
         fn(case) {
           version.is_supported_version(case.1st, case.2nd) == case.3rd
         },
       )
}

test test_is_supported_version_fail_when_the_identifier_not_match() fail {
  let test_cases: List<(List<Version>, Version, Bool)> =
    [
      (
        [
          Version {
            identifier: "2",
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
          Version {
            identifier: "3",
            features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
          },
        ],
        Version {
          identifier: "1",
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        False,
      ),
    ]
  test_cases
    |> list.all(
         fn(case) {
           version.is_supported_version(case.1st, case.2nd) == case.3rd
         },
       )
}

test test_verify_proposed_version() {
  let test_cases: List<(Version, Version, Bool)> =
    [
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        True,
      ),
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_UNORDERED", "ORDER_ORDERED"],
        },
        True,
      ),
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED", "ORDER_MOCK"],
        },
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_UNORDERED", "ORDER_ORDERED"],
        },
        True,
      ),
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        Version {
          identifier: "2",
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        False,
      ),
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED", "ORDER_MOCK"],
        },
        False,
      ),
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        Version { identifier: default_ibc_version_identifier, features: [] },
        False,
      ),
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        Version { identifier: default_ibc_version_identifier, features: [] },
        False,
      ),
    ]
  //TODO: more cases for allow_nil_feature_set functions
  test_cases
    |> list.all(
         fn(case) {
           version.verify_proposed_version(case.1st, case.2nd) == case.3rd
         },
       )
}

test test_verify_supported_feature() {
  let test_cases: List<(Version, ByteArray, Bool)> =
    [
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        "ORDER_ORDERED",
        True,
      ),
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        "ORDER_UNORDERED",
        True,
      ),
      (
        Version {
          identifier: default_ibc_version_identifier,
          features: ["ORDER_ORDERED", "ORDER_UNORDERED"],
        },
        "ORDER_MOCK",
        False,
      ),
    ]
  test_cases
    |> list.all(
         fn(case) {
           version.verify_supported_feature(case.1st, case.2nd) == case.3rd
         },
       )
}
