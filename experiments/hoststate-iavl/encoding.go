package main

import "encoding/binary"

// Canonical Plutus Data CBOR. The generated Aiken tests compare the complete
// bytes with serialise_data, so witness sizes include constructors and fields.
func cborHead(major byte, n uint64) []byte {
	switch {
	case n < 24:
		return []byte{major<<5 | byte(n)}
	case n <= 255:
		return []byte{major<<5 | 24, byte(n)}
	case n <= 65535:
		return binary.BigEndian.AppendUint16([]byte{major<<5 | 25}, uint16(n))
	case n <= 4294967295:
		return binary.BigEndian.AppendUint32([]byte{major<<5 | 26}, uint32(n))
	default:
		return binary.BigEndian.AppendUint64([]byte{major<<5 | 27}, n)
	}
}

func cborInt(n int64) []byte {
	if n < 0 {
		return cborHead(1, uint64(-1-n))
	}
	return cborHead(0, uint64(n))
}

func cborBytes(b []byte) []byte {
	if len(b) <= 64 {
		return append(cborHead(2, uint64(len(b))), b...)
	}
	out := []byte{0x5f}
	for len(b) > 64 {
		out = append(out, cborBytes(b[:64])...)
		b = b[64:]
	}
	if len(b) > 0 {
		out = append(out, cborBytes(b)...)
	}
	return append(out, 0xff)
}

func constructor(index uint64, fields ...[]byte) []byte {
	out := cborHead(6, 121+index)
	if len(fields) == 0 {
		return append(out, 0x80)
	}
	out = append(out, 0x9f)
	for _, field := range fields {
		out = append(out, field...)
	}
	return append(out, 0xff)
}

func (o opened) witnessCBOR(n *node) []byte {
	if n == nil {
		return constructor(0)
	}
	if n.height == 0 {
		return constructor(1, cborBytes(n.key), cborBytes(digest(n.value)), cborInt(n.version))
	}
	if !o[n] {
		return constructor(3, cborInt(int64(n.height)), cborInt(int64(n.size)), cborInt(n.version), cborBytes(root(n.left)), cborBytes(root(n.right)))
	}
	return constructor(2, cborInt(n.version), o.witnessCBOR(n.left), o.witnessCBOR(n.right))
}
