// compact-bootstrap converts an explicitly trusted starting checkpoint into a
// small MsgCreateClient input and bounded on-chain import messages. It does not
// establish that the starting ledger or stake allocation is correct.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"cosmossdk.io/store/dbadapter"
	lc "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-v8"
	dbm "github.com/cosmos/cosmos-db"
)

func run() error {
	input := flag.String("input", "", "trusted JSON containing client and consensus records")
	output := flag.String("output", "", "output bootstrap bundle for Hermes")
	flag.Parse()
	if *input == "" || *output == "" {
		return fmt.Errorf("both -input and -output are required")
	}
	raw, err := os.ReadFile(*input)
	if err != nil {
		return err
	}
	var trusted struct {
		Client    *lc.ClientState
		Consensus *lc.ConsensusState
	}
	if err = json.Unmarshal(raw, &trusted); err != nil {
		return err
	}
	if trusted.Client == nil || trusted.Consensus == nil {
		return fmt.Errorf("trusted client and consensus are required")
	}
	client, consensus, steps, err := lc.BuildCompactBootstrap(dbadapter.Store{DB: dbm.NewMemDB()}, trusted.Client, trusted.Consensus)
	if err != nil {
		return err
	}
	bundle := struct {
		ClientState    []byte   `json:"client_state"`
		ConsensusState []byte   `json:"consensus_state"`
		Imports        [][]byte `json:"imports"`
	}{}
	bundle.ClientState, err = client.Marshal()
	if err != nil {
		return err
	}
	bundle.ConsensusState, err = consensus.Marshal()
	if err != nil {
		return err
	}
	for _, step := range steps {
		encoded, e := step.Marshal()
		if e != nil {
			return e
		}
		bundle.Imports = append(bundle.Imports, encoded)
	}
	encoded, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.OpenFile(*output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.Write(append(encoded, '\n'))
	return err
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
