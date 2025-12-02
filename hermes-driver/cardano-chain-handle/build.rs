fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Path to proto files (relative to workspace root)
    let proto_root = "../../proto-types/protos/ibc-go";
    let proto_include = std::path::Path::new(proto_root);
    
    // Proto files for Gateway gRPC services
    let proto_files = vec![
        "ibc/core/client/v1/query.proto",
        "ibc/core/client/v1/tx.proto",
        "ibc/core/connection/v1/query.proto",
        "ibc/core/connection/v1/tx.proto",
        "ibc/core/channel/v1/query.proto",
        "ibc/core/channel/v1/tx.proto",
        "ibc/core/types/v1/query.proto",
        "ibc/cardano/v1/tx.proto",
    ];
    
    // Convert to absolute paths
    let proto_paths: Vec<_> = proto_files
        .iter()
        .map(|f| proto_include.join(f))
        .collect();
    
    // Generate Rust code from protobufs
    tonic_build::configure()
        .build_server(false)  // Client only, no server stubs
        .build_client(true)   // Generate gRPC client code
        .out_dir("src/generated")  // Output directory for generated code
        .compile(&proto_paths, &[proto_include])?;
    
    println!("cargo:rerun-if-changed={}", proto_root);
    
    Ok(())
}

