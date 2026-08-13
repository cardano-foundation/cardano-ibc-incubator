package types

const (
	// ModuleName defines the module name
	ModuleName = "vesseloracle"

	// StoreKey defines the primary module store key
	StoreKey = ModuleName

	// MemStoreKey defines the in-memory store key
	MemStoreKey = "mem_vesseloracle"

	// Version defines the current version the IBC module supports
	Version = "ics20-1"

	// PortID is the default port id that module binds to
	PortID = "vesseloracle"
)

var (
	ParamsKey = []byte("p_vesseloracle")
)

var (
	// PortKey defines the key to store the port ID in store
	PortKey = KeyPrefix("vesseloracle-port-")
)

func KeyPrefix(p string) []byte {
	return []byte(p)
}
