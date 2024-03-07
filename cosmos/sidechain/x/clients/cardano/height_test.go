package cardano_test

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"

	"sidechain/x/clients/cardano"
)

func TestZeroHeight(t *testing.T) {
	require.Equal(t, cardano.Height{}, cardano.ZeroHeight())
}

func TestCompareHeights(t *testing.T) {
	testCases := []struct {
		name        string
		height1     cardano.Height
		height2     cardano.Height
		compareSign int64
	}{
		{"revision number 1 is lesser", cardano.NewHeight(1, 3), cardano.NewHeight(3, 4), -1},
		{"revision number 1 is greater", cardano.NewHeight(7, 5), cardano.NewHeight(4, 5), 1},
		{"revision height 1 is lesser", cardano.NewHeight(3, 4), cardano.NewHeight(3, 9), -1},
		{"revision height 1 is greater", cardano.NewHeight(3, 8), cardano.NewHeight(3, 3), 1},
		{"revision number is MaxUint64", cardano.NewHeight(math.MaxUint64, 1), cardano.NewHeight(0, 1), 1},
		{"revision height is MaxUint64", cardano.NewHeight(1, math.MaxUint64), cardano.NewHeight(1, 0), 1},
		{"height is equal", cardano.NewHeight(4, 4), cardano.NewHeight(4, 4), 0},
	}

	for i, tc := range testCases {
		i, tc := i, tc
		t.Run(tc.name, func(t *testing.T) {
			compare := tc.height1.Compare(tc.height2)

			switch tc.compareSign {
			case -1:
				require.True(t, compare == -1, "case %d: %s should return negative value on comparison, got: %d",
					i, tc.name, compare)
			case 0:
				require.True(t, compare == 0, "case %d: %s should return zero on comparison, got: %d",
					i, tc.name, compare)
			case 1:
				require.True(t, compare == 1, "case %d: %s should return positive value on comparison, got: %d",
					i, tc.name, compare)
			}
		})
	}
}

func TestDecrement(t *testing.T) {
	validDecrement := cardano.NewHeight(3, 3)
	expected := cardano.NewHeight(3, 2)

	actual, success := validDecrement.Decrement()
	require.Equal(t, expected, actual, "decrementing %s did not return expected height: %s. got %s",
		validDecrement, expected, actual)
	require.True(t, success, "decrement failed unexpectedly")

	invalidDecrement := cardano.NewHeight(3, 0)
	actual, success = invalidDecrement.Decrement()

	require.Equal(t, cardano.ZeroHeight(), actual, "invalid decrement returned non-zero height: %s", actual)
	require.False(t, success, "invalid decrement passed")
}

func TestString(t *testing.T) {
	_, err := cardano.ParseHeight("height")
	require.Error(t, err, "invalid height string passed")

	_, err = cardano.ParseHeight("revision-10")
	require.Error(t, err, "invalid revision string passed")

	_, err = cardano.ParseHeight("3-height")
	require.Error(t, err, "invalid revision-height string passed")

	height := cardano.NewHeight(3, 4)
	recovered, err := cardano.ParseHeight(height.String())

	require.NoError(t, err, "valid height string could not be parsed")
	require.Equal(t, height, recovered, "recovered height not equal to original height")

	parse, err := cardano.ParseHeight("3-10")
	require.NoError(t, err, "parse err")
	require.Equal(t, cardano.NewHeight(3, 10), parse, "parse height returns wrong height")
}

func TestParseChainID(t *testing.T) {
	cases := []struct {
		chainID   string
		revision  uint64
		formatted bool
	}{
		{"gaiamainnet-3", 3, true},
		{"a-1", 1, true},
		{"gaia-mainnet-40", 40, true},
		{"gaiamainnet-3-39", 39, true},
		{"gaiamainnet--", 0, false},
		{"gaiamainnet-03", 0, false},
		{"gaiamainnet--4", 0, false},
		{"gaiamainnet-3.4", 0, false},
		{"gaiamainnet", 0, false},
		{"gaiamain\nnet-1", 0, false}, // newlines not allowed in chainID
		{"gaiamainnet-1\n", 0, false}, // newlines not allowed after dash
		{"gaiamainnet\n-3", 0, false}, // newlines not allowed before revision number
		{"a--1", 0, false},
		{"-1", 0, false},
		{"--1", 0, false},
	}

	for _, tc := range cases {
		require.Equal(t, tc.formatted, cardano.IsRevisionFormat(tc.chainID), "id %s does not match expected format", tc.chainID)

		revision := cardano.ParseChainID(tc.chainID)
		require.Equal(t, tc.revision, revision, "chainID %s returns incorrect revision", tc.chainID)
	}
}

func TestSetRevisionNumber(t *testing.T) {
	// Test SetRevisionNumber
	chainID, err := cardano.SetRevisionNumber("gaiamainnet", 3)
	require.Error(t, err, "invalid revision format passed SetRevisionNumber")
	require.Equal(t, "", chainID, "invalid revision format returned non-empty string on SetRevisionNumber")
	chainID = "gaiamainnet-3"

	chainID, err = cardano.SetRevisionNumber(chainID, 4)
	require.NoError(t, err, "valid revision format failed SetRevisionNumber")
	require.Equal(t, "gaiamainnet-4", chainID, "valid revision format returned incorrect string on SetRevisionNumber")
}

func TestCompareHeight(t *testing.T) {
	height1_1 := cardano.NewHeight(1, 1)
	height1_2 := height1_1.Increment()
	decrementHeight, _ := height1_2.Decrement()
	height0_100 := cardano.NewHeight(0, 100)
	require.Equal(t, true, height1_2.GTE(height1_1), "Height(1,2) must greater than Height(1,1)")
	require.Equal(t, true, height0_100.LTE(height1_1), "Height(0,100) must less than Height(1,1)")
	require.Equal(t, true, decrementHeight.EQ(height1_1), "DecrementHeight must equal to Height(1,1)")
}
