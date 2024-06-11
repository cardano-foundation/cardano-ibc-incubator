package ibc_types

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestDecodeAuthTokenSchema(t *testing.T) {
	t.Run("Decode AuthToken Schema Successful", func(t *testing.T) {
		authTokenEncoded := "d8799f436162634378797aff"

		authTokenSchema, err := DecodeAuthTokenSchema(authTokenEncoded)
		require.Equal(t, nil, err)
		require.Equal(t, string(authTokenSchema.Name), "xyz")
		require.Equal(t, string(authTokenSchema.PolicyId), "abc")
	})
}
