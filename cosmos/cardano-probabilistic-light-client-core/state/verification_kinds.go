package state

// QueryKind values are part of the verification query protocol.
type QueryKind uint32

const (
	QueryCheckpoint          QueryKind = 0
	QueryEffectiveBindings   QueryKind = 1
	QueryStake               QueryKind = 2
	QuerySettlementCredit    QueryKind = 3
	QueryPoolProduction      QueryKind = 4
	QueryCertificateCounters QueryKind = 5
	QueryRegistrations       QueryKind = 6
	QueryMarkBindings        QueryKind = 7
	QuerySession             QueryKind = 8
	QueryReceipt             QueryKind = 9
	QueryEpochProposals      QueryKind = 10
	QueryBootstrapProgress   QueryKind = 11
	QueryReceipts            QueryKind = 12
)

// RetentionKind and OwnerKind occupy separate bytes in persisted keys. Keep
// their values explicit so adding a name cannot renumber existing records.
type RetentionKind byte

const (
	RetainSession       RetentionKind = 1
	RetainReceipt       RetentionKind = 2
	RetainCheckpoint    RetentionKind = 3
	RetainEpochProposal RetentionKind = 4
)

type OwnerKind byte

const (
	OwnerCurrentCheckpoint  OwnerKind = 1
	OwnerSessionBase        OwnerKind = 2
	OwnerReceiptCheckpoint  OwnerKind = 3
	OwnerSession            OwnerKind = 4
	OwnerRetainedCheckpoint OwnerKind = 5
	OwnerEpochProposal      OwnerKind = 6
	OwnerBootstrap          OwnerKind = 7
	OwnerRecovery           OwnerKind = 8
	OwnerRetainedReceipt    OwnerKind = 9
)

// These suffixes identify individual dependencies within an owner's key.
const (
	sessionOwnerWorking         byte = 1
	sessionOwnerAnchor          byte = 2
	sessionOwnerStake           byte = 3
	sessionOwnerCredit          byte = 4
	sessionOwnerQualified       byte = 5
	sessionOwnerPendingBody     byte = 6
	sessionOwnerOriginalReceipt byte = 7

	checkpointOwnerRegistrations     byte = 1
	checkpointOwnerMarkBindings      byte = 2
	checkpointOwnerEffectiveBindings byte = 3
	checkpointOwnerStake             byte = 4
	checkpointOwnerCredit            byte = 5
	checkpointOwnerProduction        byte = 6
	checkpointOwnerCounters          byte = 7
	checkpointOwnerSettledHistory    byte = 8
	checkpointOwnerPacket            byte = 23
	checkpointOwnerRecord            byte = 24

	receiptOwnerBase            byte = 1
	receiptOwnerAnchor          byte = 2
	receiptOwnerStake           byte = 3
	receiptOwnerOriginalReceipt byte = 4

	packetOwnerLanes  byte = 20
	packetOwnerInputs byte = 21
	packetOwnerRoutes byte = 22

	recoveryOwnerCheckpoint      byte = 0
	recoveryOwnerProofCheckpoint byte = 1
)
