use std::process::Command;

pub fn check_prerequisites() {
    println!("Checking prerequisites...");
    check_docker();
    check_aiken();
    check_deno();
    check_golang();
}

fn check_docker() {
    let docker_check = Command::new("docker").arg("--version").output();

    match docker_check {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                print!("✅ {}", version);
            } else {
                println!("Docker is not installed or not available in the PATH.");
            }
        }
        Err(e) => {
            println!("Failed to execute command: {}", e);
        }
    }
}

fn check_aiken() {
    let aiken_check = Command::new("aiken").arg("--version").output();

    match aiken_check {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                print!("✅ {}", version);
            } else {
                println!("Aiken is not installed or not available in the PATH.");
            }
        }
        Err(e) => {
            println!("Failed to execute command: {}", e);
        }
    }
}

fn check_deno() {
    let deno_check = Command::new("deno").arg("--version").output();

    match deno_check {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                if let Some(deno_version) = version.lines().next() {
                    println!("✅ {}", deno_version);
                }
            } else {
                println!("Deno is not installed or not available in the PATH.");
            }
        }
        Err(e) => {
            println!("Failed to execute command: {}", e);
        }
    }
}

fn check_golang() {
    let go_check = Command::new("go").arg("version").output();

    match go_check {
        Ok(output) => {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                print!("✅ {}", version);
            } else {
                println!("Go is not installed or not available in the PATH.");
            }
        }
        Err(e) => {
            println!("Failed to execute command: {}", e);
        }
    }
}
