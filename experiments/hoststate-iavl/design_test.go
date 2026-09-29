package main

import (
	"bytes"
	"errors"
	"math/rand"
	"testing"

	"github.com/cosmos/iavl"
)

func TestIavlCannotRebuildFromOnlyLatestValues(t *testing.T) {
	build := func(order string, versioned bool) []byte {
		tree := newTree()
		defer tree.Close()
		for _, k := range []byte(order) {
			set(tree, []byte{k}, []byte("value"))
			if versioned {
				save(tree)
			}
		}
		return bytes.Clone(tree.WorkingHash())
	}
	a := build("abcdefg", false)
	b := build("gfedcba", false)
	c := build("abcdefg", true)
	if bytes.Equal(a, b) {
		t.Fatal("fixture failed to demonstrate order-dependent roots")
	}
	if bytes.Equal(a, c) {
		t.Fatal("fixture failed to demonstrate version-dependent roots")
	}
	if !bytes.Equal(c, build("abcdefg", true)) {
		t.Fatal("exact replay failed")
	}
	t.Logf("same pairs, forward=%x reverse=%x versioned=%x", a, b, c)
}

func TestIavlFullSnapshotRestoresStructureAndVersions(t *testing.T) {
	tree := newTree()
	defer tree.Close()
	for _, key := range []string{"connection-7", "connection-2", "connection-10", "connection-4"} {
		set(tree, []byte(key), []byte("OPEN"))
		save(tree)
	}
	exported, err := tree.Export()
	must(err)
	defer exported.Close()
	restored := newTree()
	defer restored.Close()
	importer, err := restored.Import(tree.Version())
	must(err)
	defer importer.Close()
	for {
		n, err := exported.Next()
		if errors.Is(err, iavl.ErrorExportDone) {
			break
		}
		must(err)
		must(importer.Add(n))
	}
	must(importer.Commit())
	_, err = restored.LoadVersion(tree.Version())
	must(err)
	if !bytes.Equal(tree.Hash(), restored.Hash()) {
		t.Fatal("snapshot changed root")
	}
	set(tree, []byte("connection-3"), []byte("OPEN"))
	set(restored, []byte("connection-3"), []byte("OPEN"))
	if !bytes.Equal(tree.WorkingHash(), restored.WorkingHash()) {
		t.Fatal("restored next update differs")
	}
}

func TestBucketRootIsIndependentOfInsertionOrder(t *testing.T) {
	entries := make([]bucketEntry, 64)
	for i := range entries {
		entries[i] = bucketEntry{collisionDigest(i), []byte("value")}
	}
	expected := bytes.Clone(bucketTree(entries).hash)
	rng := rand.New(rand.NewSource(482))
	for i := 0; i < 100; i++ {
		rng.Shuffle(len(entries), func(i, j int) { entries[i], entries[j] = entries[j], entries[i] })
		if !bytes.Equal(bucketTree(entries).hash, expected) {
			t.Fatal("bucket order changed root")
		}
	}
}

func TestSingletonBucketPreservesExistingLeaf(t *testing.T) {
	key := []byte("connections/connection-42")
	value := []byte("OPEN")
	want := digest(append(append([]byte{0}, digest(key)...), digest(value)...))
	if !bytes.Equal(bucketTree([]bucketEntry{{digest(key), value}}).hash, want) {
		t.Fatal("singleton root changed")
	}
}
