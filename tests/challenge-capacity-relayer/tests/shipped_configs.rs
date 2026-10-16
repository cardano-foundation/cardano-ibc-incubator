use std::path::Path;

use ibc_relayer::config;

fn load_template(relative_path: &str) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative_path);
    let configuration =
        config::load(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    assert!(
        !configuration.chains.is_empty(),
        "{} must define at least one chain",
        path.display()
    );
}

#[test]
fn injective_template_loads_with_pinned_hermes() {
    load_template("chains/injective/configuration/hermes/config.toml");
}

#[test]
fn cheqd_template_loads_with_pinned_hermes() {
    load_template("chains/cheqd/configuration/hermes/config.toml");
}

#[test]
fn osmosis_template_loads_with_pinned_hermes() {
    load_template("chains/osmosis/configuration/hermes/config.toml");
}

#[test]
fn caribic_template_loads_with_pinned_hermes() {
    load_template("caribic/config/hermes-config.example.toml");
}
