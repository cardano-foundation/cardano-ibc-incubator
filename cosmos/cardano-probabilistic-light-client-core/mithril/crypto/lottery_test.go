package crypto

import (
	"math"
	"math/big"
	"testing"
)

func TestEarlyBreakTaylor(t *testing.T) {
	for x := -0.9; x <= 0.9; x += 0.01 { // Duyệt qua khoảng từ -0.9 đến 0.9 với bước nhảy 0.01
		exp := math.Exp(x)
		cmpN := new(big.Rat).SetFloat64(exp - 2e-10)
		cmpP := new(big.Rat).SetFloat64(exp + 2e-10)
		xDecimal := new(big.Rat).SetFloat64(x)

		if !taylorComparison(1000, cmpN, xDecimal) {
			t.Errorf("Failed for cmpN with x = %v", x)
		}
		if taylorComparison(1000, cmpP, xDecimal) {
			t.Errorf("Failed for cmpP with x = %v", x)
		}
	}
}
