use std::path::Path;

use async_trait::async_trait;

use crate::chains::{
    check_port_health, check_rpc_health, ChainAdapter, ChainFlagSpec, ChainFlags,
    ChainHealthStatus, ChainNetwork, ChainStartRequest,
};

mod config;
mod hermes;
mod lifecycle;

pub(crate) use config::{CosmosTestProfile, IbcSemantics};

pub struct CosmosProfilesChainAdapter;

pub static COSMOS_PROFILES_CHAIN_ADAPTER: CosmosProfilesChainAdapter = CosmosProfilesChainAdapter;

const COSMOS_PROFILE_NETWORKS: [ChainNetwork; 3] = [
    ChainNetwork {
        name: "v8-classic",
        description: "Pinned ibc-go v8.7.0 simd chain using IBC Classic semantics",
        managed_by_caribic: true,
    },
    ChainNetwork {
        name: "v10-classic",
        description: "Pinned ibc-go v10.2.0 simd chain using IBC Classic semantics",
        managed_by_caribic: true,
    },
    ChainNetwork {
        name: "v10-v2",
        description: "Pinned ibc-go v10.2.0 simd chain for deferred IBC v2 compatibility testing",
        managed_by_caribic: true,
    },
];

const LOCAL_FLAGS: [ChainFlagSpec; 1] = [ChainFlagSpec {
    name: "stateful",
    description:
        "Keep this profile's local chain state instead of rebuilding deterministic genesis",
    required: false,
}];

#[async_trait]
impl ChainAdapter for CosmosProfilesChainAdapter {
    fn id(&self) -> &'static str {
        "cosmos"
    }

    fn display_name(&self) -> &'static str {
        "Cosmos ibc-go compatibility chains"
    }

    fn default_network(&self) -> &'static str {
        "v8-classic"
    }

    fn supported_networks(&self) -> &'static [ChainNetwork] {
        &COSMOS_PROFILE_NETWORKS
    }

    fn supported_flags(&self, network: &str) -> &'static [ChainFlagSpec] {
        if CosmosTestProfile::parse(network).is_ok() {
            &LOCAL_FLAGS
        } else {
            &[]
        }
    }

    async fn start(
        &self,
        project_root_path: &Path,
        request: &ChainStartRequest<'_>,
    ) -> Result<(), String> {
        self.validate_flags(request.network, request.flags)?;
        let profile = CosmosTestProfile::parse(request.network)?.config();
        let options = CosmosProfileOptions::from_flags(request.flags)?;

        lifecycle::prepare(project_root_path, *profile, options.stateful_or(false)).map_err(
            |error| {
                format!(
                    "Failed to prepare Cosmos profile '{}': {}",
                    profile.name, error
                )
            },
        )?;
        lifecycle::start(project_root_path, *profile)
            .await
            .map_err(|error| format!("Failed to start {}: {}", profile.display_name, error))?;
        hermes::sync_profile_with_hermes(project_root_path, *profile).map_err(|error| {
            format!(
                "Started {}, but failed to sync its Hermes configuration: {}",
                profile.display_name, error
            )
        })?;

        Ok(())
    }

    fn stop(
        &self,
        project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<(), String> {
        self.validate_flags(network, flags)?;
        let profile = CosmosTestProfile::parse(network)?.config();
        lifecycle::stop(project_root_path, *profile);
        Ok(())
    }

    fn health(
        &self,
        _project_root_path: &Path,
        network: &str,
        flags: &ChainFlags,
    ) -> Result<Vec<ChainHealthStatus>, String> {
        self.validate_flags(network, flags)?;
        let profile = CosmosTestProfile::parse(network)?.config();
        let rpc_label = match profile.semantics {
            IbcSemantics::Classic => "Cosmos Classic profile (RPC)",
            IbcSemantics::V2 => "Cosmos IBC v2 profile (RPC)",
        };

        Ok(vec![
            check_rpc_health(
                "cosmos",
                profile.status_url().as_str(),
                profile.rpc_port,
                rpc_label,
            ),
            check_port_health("cosmos", profile.grpc_port, "Cosmos profile (gRPC)"),
            check_port_health("cosmos", profile.rest_port, "Cosmos profile (REST)"),
        ])
    }
}

pub(crate) fn chain_id(profile: &str) -> Result<&'static str, String> {
    Ok(CosmosTestProfile::parse(profile)?.config().chain_id)
}

pub(crate) fn configure_hermes_for_classic_route(
    project_root_path: &Path,
    profile: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let profile = CosmosTestProfile::parse(profile)
        .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?
        .config();
    hermes::configure_classic_profile(project_root_path, *profile)
}

pub(crate) fn semantics(profile: &str) -> Result<IbcSemantics, String> {
    Ok(CosmosTestProfile::parse(profile)?.config().semantics)
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct CosmosProfileOptions {
    stateful: Option<bool>,
}

impl CosmosProfileOptions {
    fn from_flags(flags: &ChainFlags) -> Result<Self, String> {
        let mut options = Self::default();

        for (flag_name, raw_value) in flags {
            match flag_name.as_str() {
                "stateful" => {
                    options.stateful = Some(parse_bool_flag("stateful", raw_value)?);
                }
                _ => {
                    return Err(format!(
                        "Unsupported Cosmos profile flag '{}'. Allowed options: stateful",
                        flag_name
                    ));
                }
            }
        }

        Ok(options)
    }

    fn stateful_or(&self, default_value: bool) -> bool {
        self.stateful.unwrap_or(default_value)
    }
}

fn parse_bool_flag(flag_name: &str, raw_value: &str) -> Result<bool, String> {
    match raw_value.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" => Ok(true),
        "0" | "false" | "no" => Ok(false),
        _ => Err(format!(
            "Option '{}' expects a boolean value (true/false), got '{}'",
            flag_name, raw_value
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    struct ProfilesManifest {
        profiles: std::collections::HashMap<String, ManifestProfile>,
    }

    #[derive(Deserialize)]
    struct ManifestProfile {
        ibc_go: ManifestIbcGo,
        semantics: String,
        chain_id: String,
        image: String,
        service: String,
        endpoints: ManifestEndpoints,
        compatibility_test: String,
    }

    #[derive(Deserialize)]
    struct ManifestIbcGo {
        version: String,
        #[serde(rename = "ref")]
        source_ref: String,
        commit: String,
        go_image: String,
    }

    #[derive(Deserialize)]
    struct ManifestEndpoints {
        rpc: String,
        grpc: String,
        rest: String,
    }

    #[derive(Deserialize)]
    struct ComposeManifest {
        services: std::collections::HashMap<String, ComposeService>,
    }

    #[derive(Deserialize)]
    struct ComposeService {
        profiles: Vec<String>,
        image: String,
        build: ComposeBuild,
        environment: std::collections::HashMap<String, serde_yaml::Value>,
        ports: Vec<String>,
    }

    #[derive(Deserialize)]
    struct ComposeBuild {
        context: String,
        dockerfile: String,
        args: std::collections::HashMap<String, serde_yaml::Value>,
    }

    fn yaml_string<'a>(
        values: &'a std::collections::HashMap<String, serde_yaml::Value>,
        key: &str,
    ) -> &'a str {
        values
            .get(key)
            .and_then(serde_yaml::Value::as_str)
            .unwrap_or_else(|| panic!("missing string value for {key}"))
    }

    #[test]
    fn profile_configs_are_unique_and_match_the_manifest() {
        let manifest_path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../chains/cosmos/profiles.yml");
        let manifest: ProfilesManifest = serde_yaml::from_str(
            &std::fs::read_to_string(manifest_path).expect("read profiles manifest"),
        )
        .expect("parse profiles manifest");
        let compose_path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../chains/cosmos/docker-compose.yml");
        let compose: ComposeManifest = serde_yaml::from_str(
            &std::fs::read_to_string(compose_path).expect("read profile compose file"),
        )
        .expect("parse profile compose file");

        let mut chain_ids = HashSet::new();
        let mut rpc_ports = HashSet::new();
        let mut grpc_ports = HashSet::new();
        let mut rest_ports = HashSet::new();
        let core_runtime_ports = HashSet::from([3_001, 6_432, 8_081, 1_337, 1_442, 5_001, 8_000]);

        for profile in CosmosTestProfile::ALL {
            let config = *profile.config();
            let manifest_profile = manifest
                .profiles
                .get(config.name)
                .expect("profile present in manifest");

            assert_eq!(manifest_profile.ibc_go.version, config.ibc_go_version);
            assert_eq!(
                manifest_profile.ibc_go.source_ref,
                format!("v{}", config.ibc_go_version)
            );
            assert_eq!(manifest_profile.ibc_go.commit.len(), 40);
            assert!(manifest_profile
                .ibc_go
                .commit
                .chars()
                .all(|character| character.is_ascii_hexdigit()));
            assert!(manifest_profile.ibc_go.go_image.starts_with("golang:"));
            assert_eq!(manifest_profile.semantics, config.semantics.as_str());
            assert_eq!(manifest_profile.chain_id, config.chain_id);
            assert_eq!(manifest_profile.service, config.service);
            assert!(manifest_profile
                .endpoints
                .rpc
                .ends_with(&format!(":{}", config.rpc_port)));
            assert!(manifest_profile
                .endpoints
                .grpc
                .ends_with(&format!(":{}", config.grpc_port)));
            assert!(manifest_profile
                .endpoints
                .rest
                .ends_with(&format!(":{}", config.rest_port)));
            assert_eq!(
                manifest_profile.compatibility_test == "enabled",
                config.supports_classic_routes()
            );

            let compose_service = compose
                .services
                .get(config.service)
                .expect("profile service present in compose file");
            assert_eq!(compose_service.profiles, vec![config.name]);
            assert_eq!(compose_service.image, manifest_profile.image);
            assert_eq!(compose_service.build.context, "../..");
            assert_eq!(compose_service.build.dockerfile, "chains/cosmos/Dockerfile");
            assert_eq!(
                yaml_string(&compose_service.build.args, "PROFILE"),
                config.name
            );
            assert_eq!(
                yaml_string(&compose_service.build.args, "IBC_GO_VERSION"),
                manifest_profile.ibc_go.version
            );
            assert_eq!(
                yaml_string(&compose_service.build.args, "IBC_GO_REF"),
                manifest_profile.ibc_go.source_ref
            );
            assert_eq!(
                yaml_string(&compose_service.build.args, "IBC_GO_COMMIT"),
                manifest_profile.ibc_go.commit
            );
            assert_eq!(
                yaml_string(&compose_service.build.args, "IBC_SEMANTICS"),
                config.semantics.as_str()
            );
            assert_eq!(
                yaml_string(&compose_service.build.args, "GO_IMAGE"),
                manifest_profile.ibc_go.go_image
            );
            assert_eq!(
                yaml_string(&compose_service.environment, "COSMOS_PROFILE"),
                config.name
            );
            assert_eq!(
                yaml_string(&compose_service.environment, "COSMOS_CHAIN_ID"),
                config.chain_id
            );
            assert_eq!(
                yaml_string(&compose_service.environment, "COSMOS_IBC_SEMANTICS"),
                config.semantics.as_str()
            );
            assert!(compose_service
                .ports
                .contains(&format!("{}:26657", config.rpc_port)));
            assert!(compose_service
                .ports
                .contains(&format!("{}:9090", config.grpc_port)));
            assert!(compose_service
                .ports
                .contains(&format!("{}:1317", config.rest_port)));

            assert!(chain_ids.insert(config.chain_id));
            assert!(rpc_ports.insert(config.rpc_port));
            assert!(grpc_ports.insert(config.grpc_port));
            assert!(rest_ports.insert(config.rest_port));
            for port in [config.rpc_port, config.grpc_port, config.rest_port] {
                assert!(
                    !core_runtime_ports.contains(&port),
                    "Cosmos profile {} port {} conflicts with the core Cardano runtime",
                    config.name,
                    port
                );
            }
        }

        assert_eq!(manifest.profiles.len(), CosmosTestProfile::ALL.len());
        assert_eq!(compose.services.len(), CosmosTestProfile::ALL.len());
    }

    #[test]
    fn v2_profile_is_selectable_but_not_classic_route_compatible() {
        assert_eq!(
            semantics("v10-v2").expect("known profile"),
            IbcSemantics::V2
        );
        assert!(!CosmosTestProfile::V10V2.config().supports_classic_routes());
        assert!(CosmosTestProfile::V8Classic
            .config()
            .supports_classic_routes());
        assert!(CosmosTestProfile::V10Classic
            .config()
            .supports_classic_routes());
    }
}
