# Use Golang Docker Image
FROM golang:1.18 as build-env

# Set working dir
WORKDIR /home/relayer

# copy code
COPY ./../.. .

RUN ls

RUN make install


FROM golang:1.18 as run-env

# Set working dir
WORKDIR /bin

# copy bin
COPY --from=build-env ${GOBIN}/rly /bin/sh

# Copy configs
COPY --from=build-env configs /home/rly/configs

# Copy pahts
COPY --from=build-env paths /home/rly/paths

# Copy entrypoint script
COPY --from=build-env ./run-relayer.sh /home/rly/

# Set permission
RUN chmod +x ./run-relayer.sh

# Run entrypoint script
ENTRYPOINT ["/bin/bash", "-c", "/home/rly/run-relayer.sh"]