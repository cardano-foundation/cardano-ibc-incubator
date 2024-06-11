package dbservice

import (
	"fmt"
	"github.com/cardano/relayer/v1/constant"
	"github.com/joho/godotenv"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

func TestQueryConnectionAndChannelUTxOs(t *testing.T) {
	err := os.Chdir("../..")
	assert.Nil(t, err)
	err = godotenv.Load()
	ConnectToDb(&DatabaseInfo{
		Name:     os.Getenv(constant.DbName),
		Driver:   os.Getenv(constant.DbDriver),
		Username: os.Getenv(constant.DbUsername),
		Password: os.Getenv(constant.DbPassword),
		SSLMode:  os.Getenv(constant.DbSslMode),
		Host:     os.Getenv(constant.DbHost),
		Port:     os.Getenv(constant.DbPort),
	})
	db := NewDBService()
	utxos, err := db.QueryConnectionAndChannelUTxOs([]uint64{18547, 19058, 67460, 77751, 78093}, "e1ade62db0694fa015abd37586d478858431a4c05f197ab7e6a99561", "3ea7ca437a63e76bb45e59255779a7dca2b1f00d3d3877cffcde3699")

	fmt.Println(utxos)
	require.Contains(t, err, "EXPIRED")
}
