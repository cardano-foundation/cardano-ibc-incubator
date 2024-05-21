package helpers

import "math"

// Fraction struct to hold the numerator and denominator
type Fraction struct {
	Numerator   uint64
	Denominator uint64
}

// Function to compute the greatest common divisor (GCD)
func gcd(a, b uint64) uint64 {
	if b == 0 {
		return a
	}
	return gcd(b, a%b)
}

// Function to convert a float to a Fraction
func floatToFraction(f float64) Fraction {
	const precision = 1e-9 // precision for floating point comparison

	// Handle special cases for zero
	if f == 0.0 {
		return Fraction{0, 1}
	}

	// Determine the sign of the fraction
	sign := int64(1)
	if f < 0 {
		sign = -1
		f = -f
	}

	// Initialize the numerator and denominator
	numerator := uint64(f)
	denominator := uint64(1)

	// Adjust until the fractional part is within the precision range
	for math.Abs(f-float64(numerator)/float64(denominator)) > precision {
		denominator *= 10
		numerator = uint64(f * float64(denominator))
	}

	// Reduce the fraction by dividing by the GCD
	g := gcd(numerator, denominator)
	numerator /= g
	denominator /= g

	return Fraction{uint64(sign) * numerator, denominator}
}
