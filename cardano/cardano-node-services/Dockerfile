# First stage: Build the Rust application
FROM rust:1.75.0 as builder
RUN cargo new --bin cardano-node-service
WORKDIR /cardano-node-service
COPY ./Cargo.toml ./Cargo.toml
RUN cargo build --release
RUN rm src/*.rs

RUN pwd
RUN ls -la
# Copy the source code into the container
ADD . ./
RUN ls -la ./target/release/deps/
# Build the application
RUN rm -rf ./target/release/deps/cardano-node-service*
RUN cargo build --release

# Second stage: Create a smaller image
FROM debian:12
WORKDIR /app
RUN apt-get update && apt install -y openssl
# Copy only the necessary artifacts from the previous stage
COPY --from=builder /cardano-node-service/.env .
COPY --from=builder /cardano-node-service/target/release/cardano-node-service .
# Set the entry point for your application
CMD ["./cardano-node-service"]
