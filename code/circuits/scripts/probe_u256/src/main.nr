fn main() {
    // Field GE via lt: a >= b iff !(a.lt(b))
    let big: Field = 1000;
    let small: Field = 500;
    assert(!big.lt(small));  // 1000 >= 500
    assert(small.lt(big));   // 500 < 1000
    assert(!big.lt(big));    // 1000 >= 1000

    // Range-check helper: assert n fits in 200 bits (so we know n < p / 2)
    let n: Field = 12345;
    let _bits: [bool; 200] = n.to_le_bits();
    // The fact that to_le_bits compiles forces the constraint that
    // n fits in 200 bits (Noir adds a bit-decomposition + assertion of equality).
}
