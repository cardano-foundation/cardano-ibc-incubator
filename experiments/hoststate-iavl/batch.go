package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Reference depth-64 sparse tree for producing reachable transaction traces.
// Unlike the single-key baseline, these siblings come from actual populated
// trees. Nodes are immutable so each model can retain the input root.
type sparseNode struct {
	left, right *sparseNode
	hash        []byte
}

func sparseHash(n *sparseNode) []byte {
	if n == nil {
		return make([]byte, 32)
	}
	return n.hash
}
func sparseSet(n *sparseNode, index uint64, depth int, hash []byte) *sparseNode {
	if depth == 64 {
		if hash == nil {
			return nil
		}
		return &sparseNode{hash: hash}
	}
	var l, r *sparseNode
	if n != nil {
		l, r = n.left, n.right
	}
	if (index>>(63-depth))&1 == 0 {
		l = sparseSet(l, index, depth+1, hash)
	} else {
		r = sparseSet(r, index, depth+1, hash)
	}
	if l == nil && r == nil {
		return nil
	}
	return &sparseNode{left: l, right: r, hash: digest(append(append([]byte{1}, sparseHash(l)...), sparseHash(r)...))}
}
func sparseSiblings(n *sparseNode, index uint64) [][]byte {
	path := make([][]byte, 64)
	for depth := 0; depth < 64; depth++ {
		var l, r *sparseNode
		if n != nil {
			l, r = n.left, n.right
		}
		if (index>>(63-depth))&1 == 0 {
			path[63-depth] = sparseHash(r)
			n = l
		} else {
			path[63-depth] = sparseHash(l)
			n = r
		}
	}
	return path
}

type operation struct{ key, value []byte }

func batchVectors() (string, []measurement) {
	var code strings.Builder
	code.WriteString("// Reachable multi-key transitions. Each IAVL batch uses one node version.\nuse iavl\nuse iavl.{Empty, Leaf, Branch, Pruned}\nuse bucket\nuse bucket.{Witness, CompressedWitness}\nuse sparse_baseline\n\n")
	var measurements []measurement
	var transactions []map[string]string
	for _, count := range []int{4096, 65536} {
		for _, scenario := range []string{"send_packet", "create_channel"} {
			t := newTree()
			var n *node
			var sparse *sparseNode
			routes := map[uint64]string{}
			seed := func(key, value []byte) {
				n = opened{}.change(n, key, nil, value, 1)
				set(t, key, value)
				kh := digest(key)
				route := binary.BigEndian.Uint64(kh)
				if prev, exists := routes[route]; exists && prev != string(key) {
					panic("unexpected real collision")
				}
				routes[route] = string(key)
				sparse = sparseSet(sparse, route, 0, bucketLeaf(bucketEntry{kh, value}))
			}
			for i := 0; i < count; i++ {
				seed([]byte(fmt.Sprintf("connections/connection-%08d", i)), []byte{0xd8, 0x79, 0x9f, 0x01, 0xff})
			}
			var ops []operation
			if scenario == "send_packet" {
				key := []byte("nextSequenceSend/ports/transfer/channels/channel-0")
				seed(key, []byte{1})
				ops = []operation{{key, []byte{2}}, {[]byte("commitments/ports/transfer/channels/channel-0/sequences/1"), append([]byte{0x58, 0x20}, bytes.Repeat([]byte{0xaa}, 32)...)}}
			} else {
				ops = []operation{
					{[]byte("channelEnds/ports/transfer/channels/channel-0"), []byte{0xd8, 0x79, 0x9f, 0x01, 0xff}},
					{[]byte("nextSequenceSend/ports/transfer/channels/channel-0"), []byte{1}},
					{[]byte("nextSequenceRecv/ports/transfer/channels/channel-0"), []byte{1}},
					{[]byte("nextSequenceAck/ports/transfer/channels/channel-0"), []byte{1}},
				}
			}
			if !bytes.Equal(root(n), t.WorkingHash()) {
				panic("batch initial root mismatch")
			}
			save(t)
			var avlCode, bucketCode, sparseCode, compressedCode strings.Builder
			fmt.Fprintf(&avlCode, "let r0 = %s\n", hx(root(n)))
			fmt.Fprintf(&bucketCode, "let r0 = %s\n", hx(sparseHash(sparse)))
			fmt.Fprintf(&sparseCode, "let r0 = %s\n", hx(sparseHash(sparse)))
			fmt.Fprintf(&compressedCode, "let r0 = %s\n", hx(sparseHash(sparse)))
			avlSize, bucketSize, sparseSize, compressedSize := 2, 2, 2, 2
			avlNodes := 0
			var avlChanges, sparseChanges, compressedChanges [][]byte
			initialRoot, initialSparse := bytes.Clone(root(n)), bytes.Clone(sparseHash(sparse))
			initialHeight, initialCount := height(n), size(n)
			for i, op := range ops {
				old, err := t.Get(op.key)
				must(err)
				o := opened{}
				index := locate(n, op.key)
				next := o.change(n, op.key, old, op.value, t.WorkingVersion())
				fmt.Fprintf(&avlCode, "let r%d = iavl.apply_update(r%d, %s, %s, %s, %d, %d, %s)\n", i+1, i, hx(op.key), hx(old), hx(op.value), t.WorkingVersion(), index, o.witness(n))
				avlSize += len(constructor(0, cborInt(int64(index)), o.witnessCBOR(n)))
				avlNodes += o.count(n)
				avlChanges = append(avlChanges, constructor(0, cborBytes(op.key), cborBytes(old), cborBytes(op.value), cborInt(int64(index)), o.witnessCBOR(n)))
				n = next
				set(t, op.key, op.value)
				if !bytes.Equal(root(n), t.WorkingHash()) {
					panic("batch update root mismatch")
				}
				kh := digest(op.key)
				route := binary.BigEndian.Uint64(kh)
				if prev, exists := routes[route]; exists && prev != string(op.key) {
					panic("unexpected real collision")
				}
				routes[route] = string(op.key)
				siblings := sparseSiblings(sparse, route)
				var parts []string
				var encoded [][]byte
				for _, sibling := range siblings {
					parts = append(parts, hx(sibling))
					encoded = append(encoded, cborBytes(sibling))
				}
				path := "[" + strings.Join(parts, ",") + "]"
				fmt.Fprintf(&bucketCode, "let r%d = bucket.apply_update(r%d, %s, %s, %s, Witness { occupant: None, bucket_path: [], outer_siblings: %s })\n", i+1, i, hx(op.key), hx(old), hx(op.value), path)
				fmt.Fprintf(&sparseCode, "let r%d = sparse_baseline.apply_update(r%d, %s, %s, %s, %s)\n", i+1, i, hx(op.key), hx(old), hx(op.value), path)
				bucketSize += len(constructor(0, constructor(1), cborList(), cborList(encoded...)))
				sparseSize += len(cborList(encoded...))
				sparseChanges = append(sparseChanges, constructor(0, cborBytes(op.key), cborBytes(old), cborBytes(op.value), cborList(encoded...)))
				var bitmap uint64
				var compressedParts []string
				var compressedCBOR [][]byte
				for h, sibling := range siblings {
					if !bytes.Equal(sibling, make([]byte, 32)) {
						bitmap |= uint64(1) << h
						compressedParts = append(compressedParts, hx(sibling))
						compressedCBOR = append(compressedCBOR, cborBytes(sibling))
					}
				}
				fmt.Fprintf(&compressedCode, "let r%d = bucket.apply_compressed_update(r%d, %s, %s, %s, CompressedWitness { occupant: None, bucket_path: [], bitmap: %d, outer_siblings: [%s] })\n", i+1, i, hx(op.key), hx(old), hx(op.value), bitmap, strings.Join(compressedParts, ","))
				compressedWitness := constructor(0, constructor(1), cborList(), cborHead(0, bitmap), cborList(compressedCBOR...))
				compressedSize += len(compressedWitness)
				compressedChanges = append(compressedChanges, constructor(0, cborBytes(op.key), cborBytes(old), cborBytes(op.value), compressedWitness))

				sparse = sparseSet(sparse, route, 0, bucketLeaf(bucketEntry{kh, op.value}))
			}
			save(t)
			for _, candidate := range []struct {
				name, body   string
				bytes, nodes int
				old, new     []byte
			}{
				{"iavl", avlCode.String(), avlSize, avlNodes, initialRoot, root(n)},
				{"bucket", bucketCode.String(), bucketSize, 64 * len(ops), initialSparse, sparseHash(sparse)},
				{"sparse", sparseCode.String(), sparseSize, 64 * len(ops), initialSparse, sparseHash(sparse)},
				{"compressed", compressedCode.String(), compressedSize, 64 * len(ops), initialSparse, sparseHash(sparse)},
			} {
				name := fmt.Sprintf("%s_%s_%d", scenario, candidate.name, count)
				fmt.Fprintf(&code, "test %s() {\n%s\nr%d == %s\n}\n", name, candidate.body, len(ops), hx(candidate.new))
				measurements = append(measurements, measurement{Name: name, Keys: initialCount, Height: initialHeight, WitnessNodes: candidate.nodes, WitnessBytes: candidate.bytes, OldRoot: fmt.Sprintf("%x", candidate.old), NewRoot: fmt.Sprintf("%x", candidate.new)})
			}
			for _, candidate := range []struct {
				name, validator string
				data            []byte
			}{
				{"iavl", "benchmark_only.iavl_batch.spend", constructor(0, cborBytes(initialRoot), cborBytes(root(n)), cborInt(t.Version()), cborList(avlChanges...))},
				{"sparse", "benchmark_only.sparse_batch.spend", constructor(0, cborBytes(initialSparse), cborBytes(sparseHash(sparse)), cborList(sparseChanges...))},
				{"compressed", "benchmark_only.bucket_batch.spend", constructor(0, cborBytes(initialSparse), cborBytes(sparseHash(sparse)), cborList(compressedChanges...))},
			} {
				transactions = append(transactions, map[string]string{"name": fmt.Sprintf("%s_%s_%d", scenario, candidate.name, count), "validator": candidate.validator, "redeemer": fmt.Sprintf("%x", candidate.data)})
			}
			must(t.Close())
		}
	}
	data, err := json.MarshalIndent(transactions, "", "  ")
	must(err)
	must(os.MkdirAll("artifacts", 0755))
	must(os.WriteFile("artifacts/transactions.json", data, 0644))
	return code.String(), measurements
}
