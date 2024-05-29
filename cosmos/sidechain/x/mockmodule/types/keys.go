package types

import "cosmossdk.io/collections"

const (
	// ModuleName defines the module name
	ModuleName = "mockmodule"

	// StoreKey defines the primary module store key
	StoreKey = ModuleName

	// MemStoreKey defines the in-memory store key
	MemStoreKey = "mem_mockmodule"

	// Version defines the current version the IBC module supports
	Version = "mockmodule-1"

	// PortID is the default port id that module binds to
	PortID = "mockmodule"
)

var (
	ParamsKey = collections.NewPrefix("p_mockmodule")
)

var (
	// PortKey defines the key to store the port ID in store
	PortKey = collections.NewPrefix("mockmodule-port-")
)

func KeyPrefix(p string) []byte {
	return []byte(p)
}
