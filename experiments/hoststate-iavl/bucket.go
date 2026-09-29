package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"sort"
	"strings"
)

type bucketEntry struct{ key, value []byte }
type bucketNode struct {
	entry       *bucketEntry
	bit         int
	left, right *bucketNode
	hash        []byte
}
type bucketStep struct {
	bit     int
	sibling []byte
}

func keyBit(key []byte, bit int) byte { return (key[8+bit/8] >> (7 - bit%8)) & 1 }
func bucketLeaf(e bucketEntry) []byte {
	return digest(append(append([]byte{0}, e.key...), digest(e.value)...))
}
func bucketBranch(bit int, l, r []byte) []byte {
	return digest(append(append([]byte{2, byte(bit)}, l...), r...))
}
func bucketTree(entries []bucketEntry) *bucketNode {
	if len(entries) == 0 {
		return nil
	}
	if len(entries) == 1 {
		e := entries[0]
		return &bucketNode{entry: &e, hash: bucketLeaf(e)}
	}
	entries = append([]bucketEntry{}, entries...)
	sort.Slice(entries, func(i, j int) bool { return bytes.Compare(entries[i].key, entries[j].key) < 0 })
	bit := 0
	for bit < 192 && keyBit(entries[0].key, bit) == keyBit(entries[len(entries)-1].key, bit) {
		bit++
	}
	if bit == 192 {
		panic("duplicate complete digest")
	}
	i := sort.Search(len(entries), func(i int) bool { return keyBit(entries[i].key, bit) == 1 })
	l, r := bucketTree(entries[:i]), bucketTree(entries[i:])
	return &bucketNode{bit: bit, left: l, right: r, hash: bucketBranch(bit, l.hash, r.hash)}
}
func bucketRoot(n *bucketNode) []byte {
	if n == nil {
		return make([]byte, 32)
	}
	return n.hash
}
func bucketPath(n *bucketNode, key []byte) (*bucketEntry, []bucketStep) {
	if n == nil {
		return nil, nil
	}
	if n.entry != nil {
		return n.entry, nil
	}
	if keyBit(key, n.bit) == 0 {
		e, p := bucketPath(n.left, key)
		return e, append(p, bucketStep{n.bit, n.right.hash})
	}
	e, p := bucketPath(n.right, key)
	return e, append(p, bucketStep{n.bit, n.left.hash})
}
func outerRoot(key, leaf []byte, siblings [][]byte) []byte {
	current := leaf
	index := binary.BigEndian.Uint64(key)
	zero := make([]byte, 32)
	for _, sibling := range siblings {
		if bytes.Equal(current, zero) && bytes.Equal(sibling, zero) {
			current = zero
		} else if index&1 == 0 {
			current = digest(append(append([]byte{1}, current...), sibling...))
		} else {
			current = digest(append(append([]byte{1}, sibling...), current...))
		}
		index >>= 1
	}
	return current
}
func cborList(items ...[]byte) []byte {
	if len(items) == 0 {
		return []byte{0x80}
	}
	out := []byte{0x9f}
	for _, item := range items {
		out = append(out, item...)
	}
	return append(out, 0xff)
}
func collisionDigest(i int) []byte {
	d := digest([]byte(fmt.Sprintf("fixture-key-%d", i)))
	copy(d[:8], bytes.Repeat([]byte{0x42}, 8))
	return d
}
func bucketVectors() (string, []measurement) {
	var code strings.Builder
	code.WriteString("// Synthetic equal 64-bit prefixes, real SHA-256 leaf and branch hashes.\nuse bucket\nuse bucket.{Witness, Occupant, Step}\nuse aiken/builtin\n\n")
	var measurements []measurement
	siblings := make([][]byte, 64)
	for i := range siblings {
		siblings[i] = digest([]byte(fmt.Sprintf("sibling-%d", i)))
	}
	for _, count := range []int{0, 1, 2, 8, 64, 193} {
		entries := make([]bucketEntry, count)
		for i := range entries {
			key := collisionDigest(i)
			if count == 193 {
				// Structural worst case: every remaining digest bit branches.
				key = make([]byte, 32)
				copy(key, bytes.Repeat([]byte{0x42}, 8))
				if i < 192 {
					key[8+i/8] = 1 << (7 - i%8)
				}
			}
			entries[i] = bucketEntry{key, []byte("old")}
		}
		for _, action := range []string{"insert", "update", "delete"} {
			if count == 0 && action != "insert" {
				continue
			}
			key, old, value := collisionDigest(count+10), []byte{}, []byte("changed")
			if action != "insert" {
				key = entries[len(entries)-1].key
				old = entries[len(entries)-1].value
			}
			if action == "delete" {
				value = nil
			}
			before := bucketTree(entries)
			occupant, path := bucketPath(before, key)
			afterEntries := append([]bucketEntry{}, entries...)
			if action == "insert" {
				afterEntries = append(afterEntries, bucketEntry{key, value})
			} else if action == "delete" {
				afterEntries = afterEntries[:len(afterEntries)-1]
			} else {
				afterEntries[len(afterEntries)-1] = bucketEntry{key, value}
			}
			after := bucketTree(afterEntries)
			owner, ownerCBOR := "None", constructor(1)
			if action == "insert" && occupant != nil {
				owner = fmt.Sprintf("Some(Occupant { key_hash: %s, value_hash: %s })", hx(occupant.key), hx(digest(occupant.value)))
				ownerCBOR = constructor(0, constructor(0, cborBytes(occupant.key), cborBytes(digest(occupant.value))))
			}
			var pathCode []string
			var pathCBOR [][]byte
			for _, step := range path {
				pathCode = append(pathCode, fmt.Sprintf("Step { bit: %d, sibling: %s }", step.bit, hx(step.sibling)))
				pathCBOR = append(pathCBOR, constructor(0, cborInt(int64(step.bit)), cborBytes(step.sibling)))
			}
			var outerCode []string
			var outerCBOR [][]byte
			for _, sibling := range siblings {
				outerCode = append(outerCode, hx(sibling))
				outerCBOR = append(outerCBOR, cborBytes(sibling))
			}
			witness := fmt.Sprintf("Witness { occupant: %s, bucket_path: [%s], outer_siblings: [%s] }", owner, strings.Join(pathCode, ","), strings.Join(outerCode, ","))
			encoded := constructor(0, ownerCBOR, cborList(pathCBOR...), cborList(outerCBOR...))
			name := fmt.Sprintf("bucket_%s_%d", action, count)
			oldRoot, newRoot := outerRoot(key, bucketRoot(before), siblings), outerRoot(key, bucketRoot(after), siblings)
			fmt.Fprintf(&code, "test %s() { bucket.apply_digest_update(%s, %s, %s, %s, %s) == %s }\n", name, hx(oldRoot), hx(key), hx(old), hx(value), witness, hx(newRoot))
			fmt.Fprintf(&code, "test encoding_%s() { let data: Data = %s\n builtin.serialise_data(data) == %s }\n", name, witness, hx(encoded))
			measurements = append(measurements, measurement{Name: name, Keys: count, Height: len(path), WitnessNodes: len(path) + 64, WitnessBytes: len(encoded), OldRoot: fmt.Sprintf("%x", oldRoot), NewRoot: fmt.Sprintf("%x", newRoot)})
		}
	}
	return code.String(), measurements
}
