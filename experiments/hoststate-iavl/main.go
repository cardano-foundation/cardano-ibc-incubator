// This executable checks an independent update model against Cosmos IAVL and
// emits partial-tree witnesses consumed by the Aiken verifier.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"strings"

	"github.com/cosmos/iavl"
	db "github.com/cosmos/iavl/db"
	ics23 "github.com/cosmos/ics23/go"
)

type node struct {
	key, value   []byte
	version      int64
	height, size int
	left, right  *node
	hash         []byte
}

func digest(b []byte) []byte { h := sha256.Sum256(b); return h[:] }
func height(n *node) int {
	if n == nil {
		return -1
	}
	return n.height
}
func size(n *node) int {
	if n == nil {
		return 0
	}
	return n.size
}
func leaf(key, value []byte, version int64) *node {
	return &node{key: bytes.Clone(key), value: bytes.Clone(value), version: version, size: 1}
}
func branch(l, r *node, version int64) *node {
	if l == nil {
		return r
	}
	if r == nil {
		return l
	}
	return &node{version: version, height: 1 + max(l.height, r.height), size: l.size + r.size, left: l, right: r}
}
func root(n *node) []byte {
	if n == nil {
		return digest(nil)
	}
	if n.hash != nil {
		return n.hash
	}
	b := binary.AppendVarint(nil, int64(n.height))
	b = binary.AppendVarint(b, int64(n.size))
	b = binary.AppendVarint(b, n.version)
	if n.height == 0 {
		b = binary.AppendUvarint(b, uint64(len(n.key)))
		b = append(b, n.key...)
		b = append(b, 32)
		b = append(b, digest(n.value)...)
	} else {
		b = append(b, 32)
		b = append(b, root(n.left)...)
		b = append(b, 32)
		b = append(b, root(n.right)...)
	}
	n.hash = digest(b)
	return n.hash
}

// Opening a node means its child structure must be included in the witness.
// Headers alone authenticate height/size/version but cannot authenticate an
// IAVL separator key. We prove insertion order using adjacent leaf ranks.
type opened map[*node]bool

func (o opened) children(n *node) (*node, *node) {
	if n == nil || n.height == 0 {
		panic("expected branch")
	}
	o[n] = true
	return n.left, n.right
}
func minimum(n *node) []byte {
	for n.height > 0 {
		n = n.left
	}
	return n.key
}
func locate(n *node, key []byte) int {
	if n == nil || n.height == 0 {
		return 0
	}
	if bytes.Compare(key, minimum(n.right)) < 0 {
		return locate(n.left, key)
	}
	return n.left.size + locate(n.right, key)
}
func (o opened) keyAt(n *node, index int) []byte {
	if n.height == 0 {
		if index != 0 {
			panic("invalid rank")
		}
		return n.key
	}
	l, r := o.children(n)
	if index < l.size {
		return o.keyAt(l, index)
	}
	return o.keyAt(r, index-l.size)
}
func (o opened) change(n *node, key, old, value []byte, v int64) *node {
	index := locate(n, key)
	if len(old) == 0 && n != nil {
		neighbor := o.keyAt(n, index)
		if bytes.Compare(key, neighbor) < 0 {
			if index > 0 && bytes.Compare(o.keyAt(n, index-1), key) >= 0 {
				panic("invalid predecessor")
			}
		} else {
			if bytes.Compare(neighbor, key) >= 0 {
				panic("key exists")
			}
			if index+1 < n.size && bytes.Compare(key, o.keyAt(n, index+1)) >= 0 {
				panic("invalid successor")
			}
		}
	}
	return o.changeAt(n, index, key, old, value, v)
}
func (o opened) rotateRight(n *node, v int64) *node {
	l, r := o.children(n)
	a, b := o.children(l)
	return branch(a, branch(b, r, v), v)
}
func (o opened) rotateLeft(n *node, v int64) *node {
	l, r := o.children(n)
	b, c := o.children(r)
	return branch(branch(l, b, v), c, v)
}
func (o opened) balance(l, r *node, v int64) *node {
	n := branch(l, r, v)
	if l == nil || r == nil {
		return n
	}
	if height(l)-height(r) > 1 {
		a, b := o.children(l)
		if height(a) < height(b) {
			n = branch(o.rotateLeft(l, v), r, v)
		}
		return o.rotateRight(n, v)
	}
	if height(r)-height(l) > 1 {
		b, c := o.children(r)
		if height(c) < height(b) {
			n = branch(l, o.rotateRight(r, v), v)
		}
		return o.rotateLeft(n, v)
	}
	return n
}
func (o opened) changeAt(n *node, index int, key, old, value []byte, v int64) *node {
	if n == nil {
		if len(old) != 0 {
			panic("missing old key")
		}
		if len(value) == 0 {
			return nil
		}
		return leaf(key, value, v)
	}
	if n.height == 0 {
		c := bytes.Compare(key, n.key)
		if c == 0 {
			if !bytes.Equal(old, n.value) {
				panic("wrong old value")
			}
			if len(value) == 0 {
				return nil
			}
			return leaf(key, value, v)
		}
		if len(old) != 0 {
			panic("wrong old key")
		}
		if len(value) == 0 {
			return n
		}
		if c < 0 {
			return branch(leaf(key, value, v), n, v)
		}
		return branch(n, leaf(key, value, v), v)
	}
	l, r := o.children(n)
	if index < l.size {
		l = o.changeAt(l, index, key, old, value, v)
	} else {
		r = o.changeAt(r, index-l.size, key, old, value, v)
	}
	if len(old) == 0 && len(value) == 0 {
		return n
	}
	return o.balance(l, r, v)
}

func hx(b []byte) string { return fmt.Sprintf("#\"%x\"", b) }
func (o opened) witness(n *node) string {
	if n == nil {
		return "Empty"
	}
	if n.height == 0 {
		return fmt.Sprintf("Leaf { key: %s, value_hash: %s, version: %d }", hx(n.key), hx(digest(n.value)), n.version)
	}
	if !o[n] {
		return fmt.Sprintf("Pruned { height: %d, size: %d, version: %d, left_hash: %s, right_hash: %s }", n.height, n.size, n.version, hx(root(n.left)), hx(root(n.right)))
	}
	return fmt.Sprintf("Branch { version: %d, left: %s, right: %s }", n.version, o.witness(n.left), o.witness(n.right))
}

type measurement struct {
	Name               string `json:"name"`
	Keys               int    `json:"keys"`
	Height             int    `json:"height"`
	WitnessNodes       int    `json:"witness_nodes"`
	WitnessBytes       int    `json:"witness_cbor_bytes"`
	OldRoot            string `json:"old_root"`
	NewRoot            string `json:"new_root"`
	MembershipBytes    int    `json:"membership_protobuf_bytes"`
	NonMembershipBytes int    `json:"nonmembership_protobuf_bytes"`
}

func (o opened) count(n *node) int {
	if n == nil || n.height == 0 || !o[n] {
		return 1
	}
	return 1 + o.count(n.left) + o.count(n.right)
}

func newTree() *iavl.MutableTree {
	return iavl.NewMutableTree(db.NewMemDB(), 0, true, iavl.NewNopLogger())
}
func must(err error) {
	if err != nil {
		panic(err)
	}
}
func save(t *iavl.MutableTree)             { _, _, err := t.SaveVersion(); must(err) }
func set(t *iavl.MutableTree, k, v []byte) { _, err := t.Set(k, v); must(err) }

func fixture(name string, n *node, t *iavl.MutableTree, key, value []byte) (*node, string, measurement) {
	old, err := t.Get(key)
	must(err)
	o := opened{}
	v := t.WorkingVersion()
	updated := o.change(n, key, old, value, v)
	if len(value) == 0 {
		_, _, err = t.Remove(key)
		must(err)
	} else {
		set(t, key, value)
	}
	if !bytes.Equal(root(updated), t.WorkingHash()) {
		panic(fmt.Sprintf("root mismatch %s: %x != %x", name, root(updated), t.WorkingHash()))
	}
	save(t)
	code := fmt.Sprintf("test %s() {\n iavl.apply_update(%s, %s, %s, %s, %d, %d, %s) == %s\n}\n", name, hx(root(n)), hx(key), hx(old), hx(value), v, locate(n, key), o.witness(n), hx(root(updated)))
	m := measurement{Name: name, Keys: size(n), Height: height(n), WitnessNodes: o.count(n), WitnessBytes: len(o.witnessCBOR(n)), OldRoot: hex.EncodeToString(root(n)), NewRoot: hex.EncodeToString(root(updated))}
	if updated != nil {
		probe := updated
		for probe.height > 0 {
			probe = probe.left
		}
		proof, err := t.GetMembershipProof(probe.key)
		must(err)
		if !ics23.VerifyMembership(ics23.IavlSpec, root(updated), proof, probe.key, probe.value) {
			panic("membership rejected")
		}
		encoded, err := proof.Marshal()
		must(err)
		m.MembershipBytes = len(encoded)
		missing := append(bytes.Clone(probe.key), 0)
		proof, err = t.GetNonMembershipProof(missing)
		must(err)
		if !ics23.VerifyNonMembership(ics23.IavlSpec, root(updated), proof, missing) {
			panic("absence rejected")
		}
		encoded, err = proof.Marshal()
		must(err)
		m.NonMembershipBytes = len(encoded)
	}
	code += fmt.Sprintf("test encoding_%s() { let data: Data = %s\n builtin.serialise_data(data) == %s }\n", name, o.witness(n), hx(o.witnessCBOR(n)))
	return updated, code, m
}

func generated() (string, []measurement) {
	var code strings.Builder
	code.WriteString("// Generated by go run . against cosmos/iavl v1.2.2.\nuse iavl\nuse iavl.{Empty, Leaf, Branch, Pruned}\nuse sparse_baseline\nuse aiken/builtin\n\n")
	var measurements []measurement
	// Exercise all four insertion rotations, deletion/collapse and overwrite.
	for _, order := range []string{"abcdef", "fedcba", "acbedf", "fdbeca"} {
		t := newTree()
		var n *node
		for i, k := range []byte(order) {
			var c string
			var m measurement
			n, c, m = fixture(fmt.Sprintf("rotation_%s_%d", order, i), n, t, []byte{k}, []byte("value"))
			code.WriteString(c)
			measurements = append(measurements, m)
		}
		for i, k := range []byte(order) {
			var c string
			var m measurement
			n, c, m = fixture(fmt.Sprintf("delete_%s_%d", order, i), n, t, []byte{k}, nil)
			code.WriteString(c)
			measurements = append(measurements, m)
		}
		must(t.Close())
	}
	{
		t := newTree()
		var n *node
		rng := rand.New(rand.NewSource(482))
		for i := 0; i < 96; i++ {
			key := []byte(fmt.Sprintf("random-%02d", rng.Intn(24)))
			old, err := t.Get(key)
			must(err)
			value := []byte(fmt.Sprintf("v-%d", i))
			if len(old) > 0 && rng.Intn(2) == 0 {
				value = nil
			}
			var c string
			var m measurement
			n, c, m = fixture(fmt.Sprintf("random_%d", i), n, t, key, value)
			code.WriteString(c)
			measurements = append(measurements, m)
		}
		must(t.Close())
	}

	for _, scale := range []struct {
		count  int
		mature bool
	}{{16, false}, {256, false}, {4096, false}, {65536, false}, {65536, true}} {
		count := scale.count
		t := newTree()
		if scale.mature {
			t.SetInitialVersion(1_000_000)
			save(t)
		}
		seedVersion := t.WorkingVersion()
		var n *node
		// Load one version, then mutate in later versions. This also checks the
		// convention for multiple writes within one HostState transaction.
		for i := 0; i < count; i++ {
			key := []byte(fmt.Sprintf("connections/connection-%08d", i))
			value := []byte{0xd8, 0x79, 0x9f, 0x01, 0xff}
			n = opened{}.change(n, key, nil, value, seedVersion)
			set(t, key, value)
		}
		if !bytes.Equal(root(n), t.WorkingHash()) {
			panic("initial tree differs")
		}
		save(t)
		for _, op := range []struct {
			name  string
			index int
			value []byte
		}{
			{"insert", count, []byte("new")},
			{"update", count / 2, []byte("changed")},
			{"delete", count / 2, nil},
		} {
			key := []byte(fmt.Sprintf("connections/connection-%08d", op.index))
			var c string
			var m measurement
			name := fmt.Sprintf("%s_%d", op.name, count)
			if scale.mature {
				name = "mature_" + name
			}
			n, c, m = fixture(name, n, t, key, op.value)
			code.WriteString(c)
			measurements = append(measurements, m)
		}
		must(t.Close())
	}
	// Baseline uses the exact current production commitment implementation.
	key, old, value := []byte("connections/connection-00032768"), []byte("old"), []byte("changed")
	siblings := make([][]byte, 64)
	for i := range siblings {
		siblings[i] = digest([]byte(fmt.Sprintf("sibling-%d", i)))
	}
	sparse := func(value []byte) []byte {
		kh := digest(key)
		current := digest(append(append([]byte{0}, kh...), digest(value)...))
		index := binary.BigEndian.Uint64(kh)
		for _, s := range siblings {
			if index&1 == 0 {
				current = digest(append(append([]byte{1}, current...), s...))
			} else {
				current = digest(append(append([]byte{1}, s...), current...))
			}
			index >>= 1
		}
		return current
	}
	parts := make([]string, 64)
	for i, s := range siblings {
		parts[i] = hx(s)
	}
	fmt.Fprintf(&code, "test sparse_64_update() { sparse_baseline.apply_update(%s, %s, %s, %s, [%s]) == %s }\n", hx(sparse(old)), hx(key), hx(old), hx(value), strings.Join(parts, ","), hx(sparse(value)))
	return code.String(), measurements
}

func differential() {
	rng := rand.New(rand.NewSource(482))
	t := newTree()
	defer t.Close()
	var n *node
	for i := 0; i < 3000; i++ {
		key := []byte(fmt.Sprintf("key-%03d", rng.Intn(300)))
		old, err := t.Get(key)
		must(err)
		value := []byte(fmt.Sprintf("value-%d", rng.Intn(1000)))
		if len(old) > 0 && rng.Intn(3) == 0 {
			value = nil
		}
		if len(old) > 0 && rng.Intn(8) == 0 {
			value = old
		}
		n = opened{}.change(n, key, old, value, t.WorkingVersion())
		if value == nil {
			_, _, err = t.Remove(key)
			must(err)
		} else {
			set(t, key, value)
		}
		if !bytes.Equal(root(n), t.WorkingHash()) {
			panic(fmt.Sprintf("differential mismatch %d", i))
		}
		// Some operations share a version, as writes within one transaction do.
		if i%3 == 0 {
			save(t)
		}
	}
}

func main() {
	differential()
	code, measurements := generated()
	bucketCode, bucketMeasurements := bucketVectors()
	must(os.WriteFile("lib/bucket_vectors.test.ak", []byte(bucketCode), 0644))
	measurements = append(measurements, bucketMeasurements...)
	batchCode, batchMeasurements := batchVectors()
	must(os.WriteFile("lib/batch_vectors.test.ak", []byte(batchCode), 0644))
	measurements = append(measurements, batchMeasurements...)
	must(os.MkdirAll("artifacts", 0755))
	must(os.WriteFile("lib/vectors.test.ak", []byte(code), 0644))
	baseline, err := os.ReadFile("../../cardano/onchain/lib/ibc/core/ics-025-handler-interface/ibc_state_commitment.ak")
	must(err)
	must(os.WriteFile("lib/sparse_baseline.ak", baseline, 0644))
	report, err := json.MarshalIndent(measurements, "", "  ")
	must(err)
	must(os.WriteFile("artifacts/measurements.json", append(report, '\n'), 0644))
	fmt.Printf("Verified 3000 IAVL differential operations and generated %d comparison measurements\n", len(measurements))
}
