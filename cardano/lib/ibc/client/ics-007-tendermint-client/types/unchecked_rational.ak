use aiken/math/rational.{Rational}

pub type UncheckedRational {
  numerator: Int,
  denominator: Int,
}

pub fn to_rational(r: UncheckedRational) -> Option<Rational> {
  rational.new(r.numerator, r.denominator)
}

pub fn new(numerator: Int, denominator: Int) -> UncheckedRational {
  UncheckedRational { numerator, denominator }
}

pub fn from_int(numerator: Int) -> UncheckedRational {
  UncheckedRational { numerator, denominator: 1 }
}