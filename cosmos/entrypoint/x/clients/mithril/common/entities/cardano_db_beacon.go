package entities

type CardanoDbBeacon struct {
	Network             string
	Epoch               Epoch
	ImmutableFileNumber ImmutableFileNumber
}
