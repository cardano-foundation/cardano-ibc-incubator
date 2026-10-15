// prepare-client encodes operator-trusted initial state for bounded creation.
// Gateway invokes it over standard input and output. It creates no files.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"cosmossdk.io/store/dbadapter"
	lc "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-v8"
	dbm "github.com/cosmos/cosmos-db"
)

type preparation struct {
	Client    []byte   `json:"client_state"`
	Consensus []byte   `json:"consensus_state"`
	Imports   [][]byte `json:"imports,omitempty"`
}

func prepare(input io.Reader, output io.Writer) error {
	var request preparation
	if err := json.NewDecoder(io.LimitReader(input, 32<<20)).Decode(&request); err != nil {
		return err
	}
	var client lc.ClientState
	var consensus lc.ConsensusState
	if err := client.Unmarshal(request.Client); err != nil {
		return err
	}
	if err := consensus.Unmarshal(request.Consensus); err != nil {
		return err
	}
	prepared, initial, steps, err := lc.BuildBootstrap(dbadapter.Store{DB: dbm.NewMemDB()}, &client, &consensus)
	if err != nil {
		return err
	}
	response := preparation{}
	if response.Client, err = prepared.Marshal(); err != nil {
		return err
	}
	if response.Consensus, err = initial.Marshal(); err != nil {
		return err
	}
	for _, step := range steps {
		raw, err := step.Marshal()
		if err != nil {
			return err
		}
		response.Imports = append(response.Imports, raw)
	}
	return json.NewEncoder(output).Encode(response)
}

func main() {
	if err := prepare(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
