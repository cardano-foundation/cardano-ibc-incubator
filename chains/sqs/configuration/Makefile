# Exporting bin folder to the path for makefile
export PATH   := $(PWD)/bin:$(PATH)
# Default Shell
export SHELL  := bash
# Type of OS: Linux or Darwin.
export OSTYPE := $(shell uname -s)

VERSION := $(shell echo $(shell git describe --tags) | sed 's/^v//')
COMMIT := $(shell git log -1 --format='%H')
GO_VERSION := $(shell cat go.mod | grep -E 'go [0-9].[0-9]+' | cut -d ' ' -f 2)
PACKAGES_UNIT=$(shell go list ./...)
DOCKER := $(shell which docker)
BUILDDIR ?= $(CURDIR)/build
RUNNER := ubuntu

BUILD_FLAGS := -tags "$(build_tags)" -ldflags '$(ldflags)'
# check for nostrip option
ifeq (,$(findstring nostrip,$(OSMOSIS_BUILD_OPTIONS)))
	BUILD_FLAGS += -trimpath
endif


# --- Tooling & Variables ----------------------------------------------------------------
include ./misc/make/tools.Makefile

# Install local dependencies
install-deps: mockery

deps: $(MOCKERY) ## Checks for Global Development Dependencies.
deps:
	@echo "Required Tools Are Available"

generate-mocks: mockery
	bin/mockery --config mockery.yaml

swagger-gen:
	$(HOME)/go/bin/swag init -g app/main.go

run:
	go run -ldflags="-X github.com/osmosis-labs/sqs/version=${VERSION}" app/*.go  --config config.json

run-docker:
	$(DOCKER) rm -f sqs
	$(DOCKER) run -d --name sqs -p 9092:9092 -p 50051:50051 -v ./config.json:/osmosis/config.json osmolabs/sqs:$(VERSION)

stop-docker:
	$(DOCKER) rm -f sqs

osmosis-start:
	$(DOCKER) run -d --name osmosis -p 26657:26657 -p 9090:9090 -p 1317:1317 -p 9091:9091 -p 6060:6060 -p 50051:50051 -v $(HOME)/.osmosisd/:/osmosis/.osmosisd/ --net host osmolabs/osmosis-dev:v24.x-4c99a57e-1712870916 "start"

osmosis-stop:
	$(DOCKER) container rm -f osmosis

all-stop: osmosis-stop

all-start: osmosis-start run

lint:
	@echo "--> Running linter"
	golangci-lint run --timeout=10m

test-unit:
	@VERSION=$(VERSION) go test -mod=readonly $(PACKAGES_UNIT)

build:
	BUILD_TAGS=muslc LINK_STATICALLY=true GOWORK=off go build -mod=readonly \
	-tags "netgo,ledger,muslc" \
	-ldflags "-w -s -linkmode=external -extldflags '-Wl,-z,muldefs -static'" \
	-v -o /osmosis/build/sqsd app/*.go 

###############################################################################
###                                Docker                                  ###
###############################################################################

docker-build:
	@DOCKER_BUILDKIT=1 $(DOCKER) build \
	-t osmolabs/sqs:$(VERSION) \
	--build-arg GO_VERSION=$(GO_VERSION) \
	--build-arg GIT_VERSION=$(VERSION) \
	--build-arg GIT_COMMIT=$(COMMIT) \
	-f Dockerfile .

# This builds a debug image with the same version as the main image
# The binary is built with the debug symbols and has started via Delve debugger.
# Developer can then attach their IDE to the running container.
# See README.md#Debugging for more details.
docker-build-debug:
	@DOCKER_BUILDKIT=1 $(DOCKER) build \
	-t osmolabs/sqs:$(VERSION)-debug \
	--build-arg GO_VERSION=$(GO_VERSION) \
	--build-arg GIT_VERSION=$(VERSION) \
	--build-arg GIT_COMMIT=$(COMMIT) \
	-f Dockerfile.debug .

# Cross-building for arm64 from amd64 (or vice-versa) takes
# a lot of time due to QEMU virtualization but it's the only way (afaik)
# to get a statically linked binary with CosmWasm

build-reproducible: build-reproducible-amd64 build-reproducible-arm64

build-reproducible-amd64: go.sum
	mkdir -p $(BUILDDIR)
	$(DOCKER) buildx create --name osmobuilder || true
	$(DOCKER) buildx use osmobuilder
	$(DOCKER) buildx build \
	--build-arg GO_VERSION=$(GO_VERSION) \
	--build-arg GIT_VERSION=$(VERSION) \
	--build-arg GIT_COMMIT=$(COMMIT) \
	--build-arg RUNNER_IMAGE=${RUNNER} \
	--platform linux/amd64 \
	-t sqs:local-amd64 \
	--load \
	-f Dockerfile .
	$(DOCKER) rm -f sqsbinary || true
	$(DOCKER) create -ti --name sqsbinary sqs:local-amd64
	$(DOCKER) cp sqsbinary:/bin/sqsd $(BUILDDIR)/sqsd-linux-amd64
	$(DOCKER) rm -f sqsbinary

build-reproducible-arm64: go.sum
	mkdir -p $(BUILDDIR)
	$(DOCKER) buildx create --name osmobuilder || true
	$(DOCKER) buildx use osmobuilder
	$(DOCKER) buildx build \
	--build-arg GO_VERSION=$(GO_VERSION) \
	--build-arg GIT_VERSION=$(VERSION) \
	--build-arg GIT_COMMIT=$(COMMIT) \
	--build-arg RUNNER_IMAGE=${RUNNER} \
	--platform linux/arm64 \
	-t sqs:local-arm64 \
	--load \
	-f Dockerfile .
	$(DOCKER) rm -f sqsbinary || true
	$(DOCKER) create -ti --name sqsbinary sqs:local-arm64
	$(DOCKER) cp sqsbinary:/bin/sqsd $(BUILDDIR)/sqsd-linux-arm64
	$(DOCKER) rm -f sqsbinary
###############################################################################
###                                Utils                                    ###
###############################################################################

load-test-ui:
	$(DOCKER) compose -f locust/docker-compose.yml up --scale worker=4

profile:
	go tool pprof -http=:8080 http://localhost:9092/debug/pprof/profile?seconds=60

# Validates that SQS concentrated liquidity pool state is
# consistent with the state of the chain.
validate-cl-state:
	scripts/validate-cl-state.sh "http://localhost:9092"

# Compares the quotes between SQS and chain over pool 1136
# which is concentrated.
quote-compare:
	scripts/quote.sh "http://localhost:9092"

sqs-quote-compare-stage:
	ingest/sqs/scripts/quote.sh "http://165.227.168.61"

# Updates go tests with the latest mainnet state
# Make sure that the node is running locally
sqs-update-mainnet-state:
	curl -X POST "http:/localhost:9092/router/store-state"
	mv pools.json router/usecase/routertesting/parsing/pools.json
	mv taker_fees.json router/usecase/routertesting/parsing/taker_fees.json
	mv candidate_route_search_data.json router/usecase/routertesting/parsing/candidate_route_search_data.json

	curl -X POST "http:/localhost:9092/tokens/store-state"
	mv tokens.json router/usecase/routertesting/parsing/tokens.json
	mv pool_denom_metadata.json router/usecase/routertesting/parsing/pool_denom_metadata.json

# Bench tests pricing
bench-pricing:
	go test -bench BenchmarkGetPrices -run BenchmarkGetPrices github.com/osmosis-labs/sqs/tokens/usecase -count=6

proto-gen:
	protoc --go_out=./ --go-grpc_out=./ --proto_path=./sqsdomain/proto ./sqsdomain/proto/ingest.proto

test-prices-mainnet:
	CI_SQS_PRICING_WORKER_TEST=true go test \
		-timeout 300s \
		-run TestPricingWorkerTestSuite/TestGetPrices_Chain_FindUnsupportedTokens \
		github.com/osmosis-labs/sqs/tokens/usecase/pricing/worker -v -count=1

### E2E Test

# Run E2E tests in verbose mode (-s) -n 4 concurrent workers
e2e-run-stage:
	SQS_ENVIRONMENTS=stage pytest -s -n 4 --ignore=tests/test_synthetic_geo.py

e2e-run-local:
	SQS_ENVIRONMENTS=local pytest -s -n 4 --ignore=tests/test_synthetic_geo.py

#### E2E Python Setup

# Setup virtual environment for e2e tests
e2e-setup-venv:
	python3 -m venv tests/venv

# Activate virtual environment for e2e tests
e2e-source-venv:
	source tests/venv/bin/activate

# 
e2e-install-requirements:
	pip install -r tests/requirements.txt

# Persist any new dependencies to requirements.txt
e2e-update-requirements:
	pip freeze > tests/requirements.txt

# Set DATADOG_API_KEY in the environment
datadog-agent-start:
	export DATADOG_API_KEY=@@REDACTED@@; \
	docker run --cgroupns host \
				--pid host \
				-v /var/run/docker.sock:/var/run/docker.sock:ro \
				-v /proc/:/host/proc/:ro \
				-v /sys/fs/cgroup/:/host/sys/fs/cgroup:ro \
				-p 127.0.0.1:8126:8126/tcp \
				-p 127.0.0.1:4317:4317/tcp \
				-e DD_API_KEY=$$DATADOG_API_KEY \
				-e DD_APM_ENABLED=true \
				-e DD_SITE=us5.datadoghq.com \
				-e DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_GRPC_ENDPOINT=0.0.0.0:4317 \
				gcr.io/datadoghq/agent:latest
