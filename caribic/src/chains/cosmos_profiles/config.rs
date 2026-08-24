use std::path::{Path, PathBuf};

use dirs::home_dir;

pub(super) const RELAYER_MNEMONIC: &str = "sketch mountain erode window enact net enrich smoke claim kangaroo another visual write meat latin bacon pulp similar forum guilt father state erase bright";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum IbcSemantics {
    Classic,
    V2,
}

impl IbcSemantics {
    #[cfg(test)]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Classic => "classic",
            Self::V2 => "v2",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CosmosTestProfile {
    V8Classic,
    V10Classic,
    V10V2,
}

impl CosmosTestProfile {
    #[cfg(test)]
    pub(crate) const ALL: [Self; 3] = [Self::V8Classic, Self::V10Classic, Self::V10V2];

    pub(crate) fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "v8-classic" => Ok(Self::V8Classic),
            "v10-classic" => Ok(Self::V10Classic),
            "v10-v2" => Ok(Self::V10V2),
            other => Err(format!(
                "Unsupported Cosmos compatibility profile '{}'. Supported: v8-classic, v10-classic, v10-v2",
                other
            )),
        }
    }

    pub(crate) fn config(self) -> &'static CosmosProfileConfig {
        match self {
            Self::V8Classic => &V8_CLASSIC,
            Self::V10Classic => &V10_CLASSIC,
            Self::V10V2 => &V10_V2,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct CosmosProfileConfig {
    pub name: &'static str,
    pub display_name: &'static str,
    pub ibc_go_version: &'static str,
    pub semantics: IbcSemantics,
    pub chain_id: &'static str,
    pub service: &'static str,
    pub rpc_port: u16,
    pub grpc_port: u16,
    pub rest_port: u16,
}

impl CosmosProfileConfig {
    pub(crate) fn status_url(self) -> String {
        format!("http://127.0.0.1:{}/status", self.rpc_port)
    }

    pub(crate) fn state_dir(self, project_root: &Path) -> PathBuf {
        if let Some(state_root) = std::env::var_os("COSMOS_PROFILES_STATE_DIR") {
            if !state_root.is_empty() {
                let state_root = PathBuf::from(state_root);
                let state_root = if state_root.is_absolute() {
                    state_root
                } else {
                    project_root.join("chains").join("cosmos").join(state_root)
                };
                return state_root.join(self.name);
            }
        }

        if let Some(home) = home_dir() {
            return home
                .join(".caribic")
                .join("cosmos-profiles")
                .join(self.name);
        }

        project_root
            .join(".caribic")
            .join("cosmos-profiles")
            .join(self.name)
    }

    pub(crate) fn supports_classic_routes(self) -> bool {
        self.semantics == IbcSemantics::Classic
    }
}

const V8_CLASSIC: CosmosProfileConfig = CosmosProfileConfig {
    name: "v8-classic",
    display_name: "ibc-go v8 Classic",
    ibc_go_version: "8.7.0",
    semantics: IbcSemantics::Classic,
    chain_id: "v8-classic-1",
    service: "v8-classic",
    rpc_port: 26_757,
    grpc_port: 9_100,
    rest_port: 1_327,
};

const V10_CLASSIC: CosmosProfileConfig = CosmosProfileConfig {
    name: "v10-classic",
    display_name: "ibc-go v10 Classic",
    ibc_go_version: "10.2.0",
    semantics: IbcSemantics::Classic,
    chain_id: "v10-classic-1",
    service: "v10-classic",
    rpc_port: 26_857,
    grpc_port: 9_110,
    rest_port: 1_338,
};

const V10_V2: CosmosProfileConfig = CosmosProfileConfig {
    name: "v10-v2",
    display_name: "ibc-go v10 IBC v2",
    ibc_go_version: "10.2.0",
    semantics: IbcSemantics::V2,
    chain_id: "v10-v2-1",
    service: "v10-v2",
    rpc_port: 26_957,
    grpc_port: 9_120,
    rest_port: 1_347,
};
