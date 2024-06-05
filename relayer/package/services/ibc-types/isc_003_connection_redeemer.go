package ibc_types

type HeightSchema struct {
	_              struct{} `cbor:",toarray"`
	RevisionNumber uint64
	RevisionHeight uint64
}

type InnerOpSchema struct {
	_      struct{} `cbor:",toarray"`
	Hash   uint64
	Prefix []byte
	Suffix []byte
}

type LeafOpSchema struct {
	_            struct{} `cbor:",toarray"`
	Hash         uint64
	PrehashKey   uint64
	PrehashValue uint64
	Length       uint64
	Prefix       []byte
}

type ExistenceProofSchema struct {
	_     struct{} `cbor:",toarray"`
	Key   []byte
	Value []byte
	Leaf  LeafOpSchema
	Path  []InnerOpSchema
}

type NonExistenceProofSchema struct {
	_     struct{} `cbor:",toarray"`
	Key   []byte
	Left  ExistenceProofSchema
	Right ExistenceProofSchema
}

type CommitmentProofSchema[ProofType any] struct {
	_     struct{} `cbor:",toarray"`
	Proof struct {
		_     struct{} `cbor:",toarray"`
		Value ProofType
	}
}

type MerkleProofSchema[ProofType any] struct {
	_      struct{} `cbor:",toarray"`
	Proofs []CommitmentProofSchema[ProofType]
}

type SpendConnectionRedeemerConnOpenAck[ProofTryType, ProofClientType any] struct {
	_                       struct{} `cbor:",toarray"`
	CounterpartyClientState MithrilClientStateSchema
	ProofTry                MerkleProofSchema[ProofTryType]
	ProofClient             MerkleProofSchema[ProofClientType]
	ProofHeight             HeightSchema
}

type SpendConnectionRedeemerConnOpenConfirm[ProofType any] struct {
	_           struct{} `cbor:",toarray"`
	ProofAck    MerkleProofSchema[ProofType]
	ProofHeight HeightSchema
}

type MintConnectionRedeemerConnOpenInit struct {
	_                struct{} `cbor:",toarray"`
	HandlerAuthToken AuthTokenSchema
}

type MintConnectionRedeemerConnOpenTry[ProofInitType, ProofClientType any] struct {
	_                struct{} `cbor:",toarray"`
	HandlerAuthToken AuthTokenSchema
	ClientState      MithrilClientStateSchema
	ProofInit        MerkleProofSchema[ProofInitType]
	ProofClient      MerkleProofSchema[ProofClientType]
	ProofHeight      HeightSchema
}
