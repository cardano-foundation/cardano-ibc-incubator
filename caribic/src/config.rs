use crate::logger::verbose;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub use_mithril: bool,
    pub local_osmosis: bool,
    pub services: Services,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Services {
    pub db_sync: bool,
    pub kupo: bool,
    pub ogmios: bool,
    pub cardano_node: bool,
    pub postgres: bool,
}

impl Config {
    fn default() -> Self {
        Config {
            use_mithril: false,
            local_osmosis: true,
            services: Services {
                cardano_node: true,
                postgres: true,
                db_sync: true,
                kupo: true,
                ogmios: true,
            },
        }
    }

    fn load_from_file(config_path: &str) -> Self {
        if Path::new(config_path).exists() {
            let file_content =
                fs::read_to_string(config_path).expect("Failed to read config file.");
            serde_json::from_str(&file_content).unwrap_or_else(|_| {
                eprintln!("Failed to parse config file, using default config.");
                Config::default()
            })
        } else {
            verbose("Config file not found, creating default config.");
            let default_config = Config::default();
            let json_content = serde_json::to_string_pretty(&default_config)
                .expect("Failed to serialize default config.");
            fs::write(config_path, json_content).expect("Failed to write default config file.");
            default_config
        }
    }
}

lazy_static! {
    static ref CONFIG: Mutex<Config> = Mutex::new(Config::default());
}

pub fn init(config_path: &str) {
    let mut config = CONFIG.lock().unwrap();
    *config = Config::load_from_file(config_path);
}

pub fn get_config() -> Config {
    CONFIG.lock().unwrap().clone()
}
