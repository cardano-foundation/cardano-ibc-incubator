use crate::logger::{error, get_verbosity, log, verbose, Verbosity};
use crate::utils::{download_file, unzip_file, IndicatorMessage};
use console::style;
use dirs::home_dir;
use fs_extra::dir::create_all;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{stdin, stdout, Write};
use std::path::Path;
use std::process;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub project_root: String,
    pub mithril: Mithril,
    pub local_osmosis: bool,
    pub cardano: Cardano,
    pub vessel_oracle: VesselOracle,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Mithril {
    pub enabled: bool,
    pub genesis_verification_key: String,
    pub genesis_secret_key: String,
    pub chain_observer_type: String,
    pub cardano_node_dir: String,
    pub cardano_node_version: String,
    pub aggregator_image: String,
    pub client_image: String,
    pub signer_image: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Cardano {
    pub services: Services,
    pub bootstrap_addresses: Vec<BootstrapAddress>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VesselOracle {
    pub repo_base_url: String,
    pub target_branch: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BootstrapAddress {
    pub address: String,
    pub amount: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Services {
    pub db_sync: bool,
    pub kupo: bool,
    pub ogmios: bool,
    pub cardano_node: bool,
    pub postgres: bool,
}

pub async fn create_config_file(config_path: &str) -> Config {
    let mut default_config = Config::default();

    if get_verbosity() == Verbosity::Verbose
        || get_verbosity() == Verbosity::Info
        || get_verbosity() == Verbosity::Standard
    {
        println!("Config file not found at: {}", config_path);
        let mut input = String::new();
        log(&format!(
            "Do you want to create it now? ({}es/no): ",
            style("y").bold().underlined()
        ));
        stdout().flush().unwrap();
        stdin().read_line(&mut input).unwrap();

        if let Some(home_path) = home_dir() {
            if input.trim().eq_ignore_ascii_case("yes")
                || input.trim().eq_ignore_ascii_case("y")
                || input.trim().is_empty()
            {
                let default_project_root = format!(
                    "{}/.caribic/cardano-ibc-incubator",
                    home_path.as_path().display()
                );
                log(&format!(
                    "Enter the project root path for 'cardano-ibc-incubator' (default: {}):",
                    default_project_root
                ));

                let mut project_root = String::new();
                stdin().read_line(&mut project_root).unwrap();
                let mut project_root = if project_root.trim().is_empty() {
                    default_project_root
                } else {
                    project_root.trim().to_string()
                };

                if project_root.starts_with("~") {
                    project_root = project_root.replace("~", home_path.to_str().unwrap());
                }
                let project_root_path = Path::new(&project_root);
                let parent_dir = project_root_path.parent().unwrap();

                if !project_root_path.exists() {
                    verbose(&format!(
                        "cardano-ibc-incubator folder does not exist. It will be downloaded to: {}",
                        project_root_path.display(),
                    ));

                    let default_target_branch = "main".to_string();
                    log(&format!(
                        "Enter the target branch you want to fetch the source code from (default: {}):",
                        default_target_branch
                    ));
    
                    let mut target_branch = String::new();
                    stdin().read_line(&mut target_branch).unwrap();
                    let target_branch = if target_branch.trim().is_empty() {
                        default_target_branch
                    } else {
                        target_branch.trim().to_string()
                    };

                    fs::create_dir_all(parent_dir).expect("Failed to create project root folder.");
                    let github_url = format!("https://github.com/cardano-foundation/cardano-ibc-incubator/archive/refs/heads/{}.zip", target_branch);
                    download_file(
                        &github_url,
                        &parent_dir.join("cardano-ibc-incubator-main.zip"),
                        Some(IndicatorMessage {
                            message: "Downloading cardano-ibc-incubator project".to_string(),
                            step: "Step 1/2".to_string(),
                            emoji: "📥 ".to_string(),
                        }),
                    )
                    .await
                    .expect("Failed to download cardano-ibc-incubator project");

                    log(&format!(
                        "{} 📦 Extracting cardano-ibc-incubator project...",
                        style("Step 2/2").bold().dim()
                    ));

                    unzip_file(
                        parent_dir.join("cardano-ibc-incubator-main.zip").as_path(),
                        project_root_path,
                    )
                    .expect("Failed to unzip cardano-ibc-incubator project");
                    fs::remove_file(parent_dir.join("cardano-ibc-incubator-main.zip"))
                        .expect("Failed to cleanup cardano-ibc-incubator-main.zip");
                }

                default_config.project_root = project_root.clone();
                default_config.mithril.cardano_node_dir = format!("{}/chains/cardano/devnet", project_root);
                verbose(&format!(
                    "Project root path set to: {}",
                    default_config.project_root
                ));
            } else {
                error("Config file not found. Exiting.");
                process::exit(0);
            }
        } else {
            error("Failed to resolve home directory. Exiting.");
            process::exit(0);
        }
    } else {
        error("No config file has been found. Creating a new config does not work with log levels warning, error or quite.");
        process::exit(0);
    }

    verbose(&format!("caribic config file: {:#?}", default_config));

    default_config
}

impl Config {
    fn default() -> Self {
        let mut default_config = Config {
            project_root: "/root/.caribic/cardano-ibc-incubator".to_string(),
            mithril: {
                Mithril {
                    enabled: true,
                    genesis_verification_key: "5b33322c3235332c3138362c3230312c3137372c31312c3131372c3133352c3138372c3136372c3138312c3138382c32322c35392c3230362c3130352c3233312c3135302c3231352c33302c37382c3231322c37362c31362c3235322c3138302c37322c3133342c3133372c3234372c3136312c36385d".to_string(),
                    genesis_secret_key: "5b3131382c3138342c3232342c3137332c3136302c3234312c36312c3134342c36342c39332c3130362c3232392c38332c3133342c3138392c34302c3138392c3231302c32352c3138342c3136302c3134312c3233372c32362c3136382c35342c3233392c3230342c3133392c3131392c31332c3139395d".to_string(),
                    chain_observer_type: "pallas".to_string(),
                    cardano_node_dir: "/root/.caribic/cardano-ibc-incubator/chains/cardano/devnet".to_string(),
                    cardano_node_version: "9.1.0".to_string(),
                    aggregator_image: "ghcr.io/input-output-hk/mithril-aggregator:main-9fd9ae8".to_string(),
                    client_image: "ghcr.io/input-output-hk/mithril-client:main-9fd9ae8".to_string(),
                    signer_image: "ghcr.io/input-output-hk/mithril-signer:main-9fd9ae8".to_string(),
                }
            },
            local_osmosis: true,
            cardano: Cardano {
            services: Services {
                db_sync: true,
                kupo: true,
                ogmios: true,
                cardano_node: true,
                postgres: true,
            },
            bootstrap_addresses: vec![                    
                BootstrapAddress {
                    address: "addr_test1qrwuz99eywdpm9puylccmvqfu6lue968rtt36nzeal7czuu4wq3n84h8ntp3ta30kyxx8r0x2u4tgr5a8y9hp5vjpngsmwy0wg".to_string(),
                    amount: 30000000000,
                },
                BootstrapAddress {
                    address: "addr_test1qrwuz99eywdpm9puylccmvqfu6lue968rtt36nzeal7czuu4wq3n84h8ntp3ta30kyxx8r0x2u4tgr5a8y9hp5vjpngsmwy0wg".to_string(),
                    amount: 30000000000,
                },
                BootstrapAddress {
                    address: "addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m".to_string(),
                    amount: 30000000000,
                },
                BootstrapAddress {
                    address: "addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql".to_string(),
                    amount: 30000000000,
                },
                BootstrapAddress {
                    address: "addr_test1wzfvnh20kanpp0qppn5a92kaamjdu9jfamt8hxqqrl43t7c2jw6u4".to_string(),
                    amount: 30000000000,
                },
                
            ]},
            vessel_oracle: VesselOracle {
                repo_base_url: "https://github.com/cardano-foundation/cardano-ibc-summit-demo".to_string(),
                target_branch: "main".to_string(),
            }
        };

        if let Some(home_path) = home_dir() {
            let default_project_root = format!(
                "{}/.caribic/cardano-ibc-incubator",
                home_path.as_path().display()
            );
            default_config.project_root = default_project_root.clone();
            default_config.mithril.cardano_node_dir = format!("{}/chains/cardano/devnet", default_project_root);
        }
        default_config
    }

    async fn load_from_file(config_path: &str) -> Self {
        if Path::new(config_path).exists() {
            let file_content =
                fs::read_to_string(config_path).expect("Failed to read config file.");
            serde_json::from_str(&file_content).unwrap_or_else(|_| {
                eprintln!("Failed to parse config file, using default config.");
                Config::default()
            })
        } else {
            let default_config = create_config_file(config_path).await;
            let parent_dir = Path::new(config_path).parent().unwrap();
            create_all(parent_dir, false).expect("Failed to create config dir.");
            let json_content = serde_json::to_string_pretty(&default_config)
                .expect("Failed to serialize default config.");
            fs::write(Path::new(config_path), json_content)
                .expect("Failed to write default config file.");
            default_config
        }
    }
}

lazy_static! {
    static ref CONFIG: Mutex<Config> = Mutex::new(Config::default());
}

pub async fn init(config_path: &str) {
    let mut config = CONFIG.lock().unwrap();
    *config = Config::load_from_file(config_path).await;
}

pub fn get_config() -> Config {
    CONFIG.lock().unwrap().clone()
}
