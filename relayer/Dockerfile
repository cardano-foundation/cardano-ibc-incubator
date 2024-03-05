# Use Golang Docker Image
FROM golang:1.21 as build-env

# Set working dir
WORKDIR /home/relayer

# copy code
COPY . .

COPY .env.example .env

RUN make build -o bin/rly


FROM golang:1.21 as run-env

# Set working dir
WORKDIR /home/relayer

# copy bin
COPY --from=build-env /home/relayer/bin/rly /bin

# copy .env
COPY --from=build-env /home/relayer/.env /home/relayer

# Copy configs
COPY --from=build-env /home/relayer/configs /home/relayer/configs

# Copy paths
COPY --from=build-env /home/relayer/paths /home/relayer/paths

# Copy data
COPY --from=build-env /home/relayer/data /home/relayer/data

# Copy entrypoint script
COPY --from=build-env /home/relayer/relayer-start.sh /home/relayer

COPY --from=build-env /home/relayer/update-client.sh /home/relayer

# Set permission
RUN chmod +x /home/relayer/relayer-start.sh

RUN chmod +x /home/relayer/update-client.sh

# Run entrypoint script
CMD ["sleep", "infinity"]