# How to run

### Start Plutip cluster

* Go to `/plutip` in this repo.
* Run `nix run .` to start the plutip cluster.

### Start CTL Test Server

We need a few changes to the CTL tests:
https://github.com/Plutonomicon/cardano-transaction-lib/pull/1606

* Checkout the branch of the above PR
* Run `npm i` to install the deps
* Install `spago` and `purescript` as needed
* Run `npm run esbuild-serve`
  * The test server should start at port `4008`

### Run E2E Tests

* Wait for the Plutip cluster and the CTL Test Server to be up and running.
* Go to `/webext` in this repo
* Run `node build.js --test` to start the E2E test suite.
