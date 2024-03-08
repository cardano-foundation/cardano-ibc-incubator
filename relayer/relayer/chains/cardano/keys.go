package cardano

import (
	"context"
	"errors"
	"os"

	"github.com/cardano/relayer/v1/relayer/chains/cosmos/keys/sr25519"
	"github.com/cardano/relayer/v1/relayer/codecs/ethermint"
	"github.com/cardano/relayer/v1/relayer/codecs/injective"
	"github.com/cardano/relayer/v1/relayer/provider"
	"github.com/cosmos/cosmos-sdk/crypto/hd"
	"github.com/cosmos/cosmos-sdk/crypto/keyring"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/go-bip39"
)

const ethereumCoinType = uint32(60)

var (
	// SupportedAlgorithms defines the list of signing algorithms used on Evmos:
	//  - secp256k1     (Cosmos)
	//  - sr25519		(Cosmos)
	//  - eth_secp256k1 (Ethereum, Injective)

	SupportedAlgorithms = keyring.SigningAlgoList{hd.Secp256k1, sr25519.Sr25519, ethermint.EthSecp256k1, injective.EthSecp256k1}
	// SupportedAlgorithmsLedger defines the list of signing algorithms used on Evmos for the Ledger device:
	//  - secp256k1     (Cosmos)
	//  - sr25519		(Cosmos)
	//  - eth_secp256k1 (Ethereum, Injective)
	SupportedAlgorithmsLedger = keyring.SigningAlgoList{hd.Secp256k1, sr25519.Sr25519, ethermint.EthSecp256k1, injective.EthSecp256k1}
)

// KeyringAlgoOptions defines a function keys options for the ethereum Secp256k1 curve.
// It supports secp256k1 and eth_secp256k1 keys for accounts.
func KeyringAlgoOptions() keyring.Option {
	return func(options *keyring.Options) {
		options.SupportedAlgos = SupportedAlgorithms
		options.SupportedAlgosLedger = SupportedAlgorithmsLedger
	}
}

// CreateKeystore initializes a new instance of a keyring at the specified path in the local filesystem.
func (cc *CardanoProvider) CreateKeystore(path string) error {
	keybase, err := keyring.New(cc.PCfg.ChainID, cc.PCfg.KeyringBackend, cc.PCfg.KeyDirectory, cc.Input, cc.Cdc.Marshaler, KeyringAlgoOptions())
	if err != nil {
		return err
	}
	cc.Keybase = keybase
	return nil
}

// KeystoreCreated returns true if there is an existing keystore instance at the specified path, it returns false otherwise.
func (cc *CardanoProvider) KeystoreCreated(path string) bool {
	if _, err := os.Stat(cc.PCfg.KeyDirectory); errors.Is(err, os.ErrNotExist) {
		return false
	} else if cc.Keybase == nil {
		return false
	}
	return true
}

// AddKey generates a new mnemonic which is then converted to a private key and BIP-39 HD Path and persists it to the keystore.
// It fails if there is an existing key with the same address.
func (cc *CardanoProvider) AddKey(name string, coinType uint32, signingAlgorithm string) (output *provider.KeyOutput, err error) {
	address, err := cc.TxCardano.AddKey(context.Background(), name, cc.PCfg.ChainID)
	if err != nil {
		return nil, err
	}

	res := &provider.KeyOutput{
		Address: address,
	}

	return res, nil
}

// Updates config.yaml chain with the specified key.
// It fails config is  already using the same key or if the key does not exist
func (cc *CardanoProvider) UseKey(key string) error {
	cc.PCfg.Key = key
	return nil
}

// RestoreKey converts a mnemonic to a private key and BIP-39 HD Path and persists it to the keystore.
// It fails if there is an existing key with the same address.
func (cc *CardanoProvider) RestoreKey(name, mnemonic string, coinType uint32, signingAlgorithm string) (address string, err error) {
	address, err = cc.TxCardano.RestoreKey(context.Background(), name, cc.PCfg.ChainID, mnemonic)
	if err != nil {
		return "", err
	}
	return address, nil
}

// KeyAddOrRestore either generates a new mnemonic or uses the specified mnemonic and converts it to a private key
// and BIP-39 HD Path which is then persisted to the keystore. It fails if there is an existing key with the same address.
func (cc *CardanoProvider) KeyAddOrRestore(keyName string, coinType uint32, signingAlgorithm string, mnemonic ...string) (*provider.KeyOutput, error) {
	// Not implement for Cardano Chain
	return nil, nil
}

// ShowAddress retrieves a key by name from the keystore and returns the bech32 encoded string representation of that key.
func (cc *CardanoProvider) ShowAddress(name string) (address string, err error) {
	address, err = cc.TxCardano.ShowAddress(context.Background(), name, cc.PCfg.ChainID)
	if err != nil {
		return "", nil
	}
	return address, nil
}

// ListAddresses returns a map of bech32 encoded strings representing all keys currently in the keystore.
func (cc *CardanoProvider) ListAddresses() (map[string]string, error) {
	out, err := cc.TxCardano.ListAddresses(context.Background(), cc.PCfg.ChainID)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// DeleteKey removes a key from the keystore for the specified name.
func (cc *CardanoProvider) DeleteKey(name string) error {
	_, err := cc.TxCardano.DeleteKey(context.Background(), name, cc.PCfg.ChainID)
	if err != nil {
		return err
	}
	return nil
}

// KeyExists returns true if a key with the specified name exists in the keystore, it returns false otherwise.
func (cc *CardanoProvider) KeyExists(name string) bool {
	out, err := cc.TxCardano.KeyExist(context.Background(), name, cc.PCfg.ChainID)
	if err != nil {
		return false
	}
	return out
}

// ExportPrivKeyArmor returns a private key in ASCII armored format.
// It returns an error if the key does not exist or a wrong encryption passphrase is supplied.
func (cc *CardanoProvider) ExportPrivKeyArmor(keyName string) (armor string, err error) {
	// Not implement for Cardano Chain
	return "", nil
}

// GetKeyAddress returns the account address representation for the currently configured key.
func (cc *CardanoProvider) GetKeyAddress(key string) (sdk.AccAddress, error) {
	info, err := cc.Keybase.Key(key)
	if err != nil {
		return nil, err
	}
	return info.GetAddress()
}

// CreateMnemonic generates a new mnemonic.
func CreateMnemonic() (string, error) {
	entropySeed, err := bip39.NewEntropy(256)
	if err != nil {
		return "", err
	}
	mnemonic, err := bip39.NewMnemonic(entropySeed)
	if err != nil {
		return "", err
	}
	return mnemonic, nil
}

// EncodeBech32AccAddr returns the string bech32 representation for the specified account address.
// It returns an empty sting if the byte slice is 0-length.
// It returns an error if the bech32 conversion fails or the prefix is empty.
func (cc *CardanoProvider) EncodeBech32AccAddr(addr sdk.AccAddress) (string, error) {
	return sdk.Bech32ifyAddressBytes(cc.PCfg.AccountPrefix, addr)
}

func (cc *CardanoProvider) DecodeBech32AccAddr(addr string) (sdk.AccAddress, error) {
	return sdk.GetFromBech32(addr, cc.PCfg.AccountPrefix)
}

func (cc *CardanoProvider) GetKeyAddressForKey(key string) (sdk.AccAddress, error) {
	info, err := cc.Keybase.Key(key)
	if err != nil {
		return nil, err
	}
	return info.GetAddress()
}

func (cc *CardanoProvider) KeyFromKeyOrAddress(keyOrAddress string) (string, error) {
	switch {
	case keyOrAddress == "":
		return cc.PCfg.Key, nil
	case cc.KeyExists(keyOrAddress):
		return keyOrAddress, nil
	default:
		acc, err := cc.DecodeBech32AccAddr(keyOrAddress)
		if err != nil {
			return "", err
		}
		kr, err := cc.Keybase.KeyByAddress(acc)
		if err != nil {
			return "", err
		}
		return kr.Name, nil
	}
}
