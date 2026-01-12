// Unit tests for ICS-23 Merkle Tree implementation

import { ICS23MerkleTree } from './ics23-merkle-tree';

describe('ICS23MerkleTree', () => {
  let tree: ICS23MerkleTree;

  beforeEach(() => {
    tree = new ICS23MerkleTree();
  });

  describe('Basic Operations', () => {
    it('should create an empty tree with zero root', () => {
      const root = tree.getRoot();
      expect(root).toBe('0'.repeat(64)); // 32 bytes of zeros as hex
    });

    it('should set and get values', () => {
      const key = 'test-key';
      const value = Buffer.from('test-value');

      tree.set(key, value);
      const retrieved = tree.get(key);

      expect(retrieved).toEqual(value);
    });

    it('should return undefined for non-existent keys', () => {
      const retrieved = tree.get('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should delete keys', () => {
      const key = 'test-key';
      const value = Buffer.from('test-value');

      tree.set(key, value);
      expect(tree.get(key)).toEqual(value);

      tree.delete(key);
      expect(tree.get(key)).toBeUndefined();
    });

    it('should track tree size', () => {
      expect(tree.size()).toBe(0);

      tree.set('key1', Buffer.from('value1'));
      expect(tree.size()).toBe(1);

      tree.set('key2', Buffer.from('value2'));
      expect(tree.size()).toBe(2);

      tree.delete('key1');
      expect(tree.size()).toBe(1);
    });
  });

  describe('Root Computation', () => {
    it('should compute different roots for different data', () => {
      const tree1 = new ICS23MerkleTree();
      tree1.set('key1', Buffer.from('value1'));
      const root1 = tree1.getRoot();

      const tree2 = new ICS23MerkleTree();
      tree2.set('key1', Buffer.from('value2'));
      const root2 = tree2.getRoot();

      expect(root1).not.toBe(root2);
    });

    it('should compute same root for same data regardless of insertion order', () => {
      const tree1 = new ICS23MerkleTree();
      tree1.set('key1', Buffer.from('value1'));
      tree1.set('key2', Buffer.from('value2'));
      const root1 = tree1.getRoot();

      const tree2 = new ICS23MerkleTree();
      tree2.set('key2', Buffer.from('value2'));
      tree2.set('key1', Buffer.from('value1'));
      const root2 = tree2.getRoot();

      expect(root1).toBe(root2);
    });

    it('should update root when data changes', () => {
      tree.set('key1', Buffer.from('value1'));
      const root1 = tree.getRoot();

      tree.set('key2', Buffer.from('value2'));
      const root2 = tree.getRoot();

      expect(root1).not.toBe(root2);
    });

    it('should return to empty root when all keys are deleted', () => {
      tree.set('key1', Buffer.from('value1'));
      tree.set('key2', Buffer.from('value2'));
      
      const nonEmptyRoot = tree.getRoot();
      expect(nonEmptyRoot).not.toBe('0'.repeat(64));

      tree.delete('key1');
      tree.delete('key2');

      const emptyRoot = tree.getRoot();
      expect(emptyRoot).toBe('0'.repeat(64));
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize tree state', () => {
      tree.set('key1', Buffer.from('value1'));
      tree.set('key2', Buffer.from('value2'));
      const originalRoot = tree.getRoot();

      const json = tree.toJSON();
      const restoredTree = ICS23MerkleTree.fromJSON(json);
      const restoredRoot = restoredTree.getRoot();

      expect(restoredRoot).toBe(originalRoot);
      expect(restoredTree.get('key1')).toEqual(Buffer.from('value1'));
      expect(restoredTree.get('key2')).toEqual(Buffer.from('value2'));
    });

    it('should handle empty tree serialization', () => {
      const json = tree.toJSON();
      const restoredTree = ICS23MerkleTree.fromJSON(json);

      expect(restoredTree.getRoot()).toBe('0'.repeat(64));
      expect(restoredTree.size()).toBe(0);
    });
  });

  describe('Cloning', () => {
    it('should clone tree with all data', () => {
      tree.set('key1', Buffer.from('value1'));
      tree.set('key2', Buffer.from('value2'));

      const clonedTree = tree.clone();

      expect(clonedTree.getRoot()).toBe(tree.getRoot());
      expect(clonedTree.get('key1')).toEqual(tree.get('key1'));
      expect(clonedTree.get('key2')).toEqual(tree.get('key2'));
    });

    it('should create independent clone', () => {
      tree.set('key1', Buffer.from('value1'));
      const clonedTree = tree.clone();

      // Modify original
      tree.set('key2', Buffer.from('value2'));

      // Clone should be unaffected
      expect(clonedTree.size()).toBe(1);
      expect(clonedTree.get('key2')).toBeUndefined();
    });
  });

  describe('IBC Path Handling', () => {
    it('should handle typical IBC client paths', () => {
      const clientId = '07-tendermint-0';
      const path = `clients/${clientId}/clientState`;
      
      tree.set(path, Buffer.from('client-state-data'));
      expect(tree.get(path)).toBeDefined();
    });

    it('should handle IBC connection paths', () => {
      const connectionId = 'connection-0';
      const path = `connections/${connectionId}`;
      
      tree.set(path, Buffer.from('connection-state-data'));
      expect(tree.get(path)).toBeDefined();
    });

    it('should handle IBC channel paths', () => {
      const portId = 'transfer';
      const channelId = 'channel-0';
      const path = `channelEnds/ports/${portId}/channels/${channelId}`;
      
      tree.set(path, Buffer.from('channel-state-data'));
      expect(tree.get(path)).toBeDefined();
    });
  });

  describe('Root Hash Format', () => {
    it('should return 64-character hex string for root', () => {
      tree.set('key1', Buffer.from('value1'));
      const root = tree.getRoot();

      expect(typeof root).toBe('string');
      expect(root.length).toBe(64); // 32 bytes as hex
      expect(/^[0-9a-f]{64}$/.test(root)).toBe(true);
    });
  });

  describe('Proof Generation', () => {
    describe('ExistenceProof', () => {
      it('should generate proof for single-leaf tree', () => {
        tree.set('key1', Buffer.from('value1'));
        
        const proof = tree.generateProof('key1');
        
        expect(proof.key).toEqual(Buffer.from('key1', 'utf8'));
        expect(proof.value).toEqual(Buffer.from('value1'));
        expect(proof.leaf.hash).toBe(1); // SHA256
        expect(proof.leaf.length).toBe(1); // VAR_PROTO
        expect(proof.path).toHaveLength(0); // No inner nodes for single leaf
      });

      it('should generate proof for multi-leaf tree', () => {
        tree.set('key1', Buffer.from('value1'));
        tree.set('key2', Buffer.from('value2'));
        tree.set('key3', Buffer.from('value3'));
        
        const proof = tree.generateProof('key2');
        
        expect(proof.key).toEqual(Buffer.from('key2', 'utf8'));
        expect(proof.value).toEqual(Buffer.from('value2'));
        expect(proof.path.length).toBeGreaterThan(0); // Should have inner nodes
        
        // Verify all InnerOps have correct structure
        proof.path.forEach((innerOp) => {
          expect(innerOp.hash).toBe(1); // SHA256
          expect(Buffer.isBuffer(innerOp.prefix)).toBe(true);
          expect(Buffer.isBuffer(innerOp.suffix)).toBe(true);
        });
      });

      it('should generate valid proof that reconstructs root', () => {
        tree.set('clients/07-tendermint-0/clientState', Buffer.from('client-data'));
        tree.set('connections/connection-0', Buffer.from('connection-data'));
        tree.set('channelEnds/ports/transfer/channels/channel-0', Buffer.from('channel-data'));
        
        const targetKey = 'connections/connection-0';
        const proof = tree.generateProof(targetKey);
        
        // Use built-in verifyProof method
        const isValid = tree.verifyProof(proof);
        expect(isValid).toBe(true);
      });

      it('should throw error for non-existent key', () => {
        tree.set('key1', Buffer.from('value1'));
        
        expect(() => tree.generateProof('non-existent')).toThrow(
          /Cannot generate proof: key 'non-existent' not found in tree/
        );
      });

      it('should throw error for empty tree', () => {
        expect(() => tree.generateProof('any-key')).toThrow(
          /Cannot generate proof: tree is empty/
        );
      });

      it('should generate different proofs for different keys', () => {
        tree.set('key1', Buffer.from('value1'));
        tree.set('key2', Buffer.from('value2'));
        tree.set('key3', Buffer.from('value3'));
        
        const proof1 = tree.generateProof('key1');
        const proof2 = tree.generateProof('key2');
        
        expect(proof1.key).not.toEqual(proof2.key);
        expect(proof1.value).not.toEqual(proof2.value);
        // Paths may differ in length or content
      });

      it('should handle IBC paths correctly', () => {
        const clientPath = 'clients/07-tendermint-0/clientState';
        const connectionPath = 'connections/connection-0';
        
        tree.set(clientPath, Buffer.from('client-state'));
        tree.set(connectionPath, Buffer.from('connection-state'));
        
        const clientProof = tree.generateProof(clientPath);
        const connectionProof = tree.generateProof(connectionPath);
        
        expect(tree.verifyProof(clientProof)).toBe(true);
        expect(tree.verifyProof(connectionProof)).toBe(true);
      });

      it('should generate proofs for all leaves in large tree', () => {
        // Create a larger tree
        for (let i = 0; i < 10; i++) {
          tree.set(`key${i}`, Buffer.from(`value${i}`));
        }
        
        // Generate and verify proofs for all leaves
        const keys = tree.getKeys();
        keys.forEach((key) => {
          const proof = tree.generateProof(key);
          expect(tree.verifyProof(proof)).toBe(true);
        });
      });
    });

    describe('NonExistenceProof', () => {
      it('should generate non-existence proof with left and right neighbors', () => {
        tree.set('clients/07-tendermint-0/clientState', Buffer.from('client0'));
        tree.set('clients/07-tendermint-2/clientState', Buffer.from('client2'));
        
        const nonExistentKey = 'clients/07-tendermint-1/clientState';
        const proof = tree.generateNonExistenceProof(nonExistentKey);
        
        expect(proof.key).toEqual(Buffer.from(nonExistentKey, 'utf8'));
        expect(proof.left).not.toBeNull();
        expect(proof.right).not.toBeNull();
        
        // Verify left neighbor is before target
        expect(proof.left!.key.toString('utf8')).toBe('clients/07-tendermint-0/clientState');
        
        // Verify right neighbor is after target
        expect(proof.right!.key.toString('utf8')).toBe('clients/07-tendermint-2/clientState');
      });

      it('should generate valid neighbor proofs', () => {
        tree.set('key1', Buffer.from('value1'));
        tree.set('key3', Buffer.from('value3'));
        
        const proof = tree.generateNonExistenceProof('key2');
        
        // Both neighbor proofs should be valid
        if (proof.left) {
          expect(tree.verifyProof(proof.left)).toBe(true);
        }
        if (proof.right) {
          expect(tree.verifyProof(proof.right)).toBe(true);
        }
      });

      it('should throw error for existing key', () => {
        tree.set('key1', Buffer.from('value1'));
        
        expect(() => tree.generateNonExistenceProof('key1')).toThrow(
          /Cannot generate non-existence proof: key 'key1' exists in tree/
        );
      });

      it('should throw error for empty tree', () => {
        expect(() => tree.generateNonExistenceProof('any-key')).toThrow(
          /Cannot generate non-existence proof: tree is empty/
        );
      });

      it('should handle key before all existing keys', () => {
        tree.set('key5', Buffer.from('value5'));
        tree.set('key10', Buffer.from('value10'));
        
        const proof = tree.generateNonExistenceProof('key1');
        
        // Should have right neighbor but no left
        expect(proof.left).toBeNull();
        expect(proof.right).not.toBeNull();
        expect(proof.right!.key.toString('utf8')).toBe('key10'); // Lexicographically first
      });

      it('should handle key after all existing keys', () => {
        tree.set('key1', Buffer.from('value1'));
        tree.set('key5', Buffer.from('value5'));
        
        const proof = tree.generateNonExistenceProof('key9');
        
        // Should have left neighbor but no right
        expect(proof.left).not.toBeNull();
        expect(proof.left!.key.toString('utf8')).toBe('key5');
        expect(proof.right).toBeNull();
      });
    });

    describe('Proof Verification', () => {
      it('should verify valid proof reconstructs correct root', () => {
        tree.set('clients/07-tendermint-0/clientState', Buffer.from('client-data'));
        tree.set('connections/connection-0', Buffer.from('connection-data'));
        
        const proof = tree.generateProof('connections/connection-0');
        const isValid = tree.verifyProof(proof);
        
        expect(isValid).toBe(true);
      });

      it('should detect tampered proof', () => {
        tree.set('key1', Buffer.from('value1'));
        tree.set('key2', Buffer.from('value2'));
        
        const proof = tree.generateProof('key1');
        
        // Tamper with the value
        proof.value = Buffer.from('tampered-value');
        
        const isValid = tree.verifyProof(proof);
        expect(isValid).toBe(false);
      });

      it('should detect tampered inner path', () => {
        tree.set('key1', Buffer.from('value1'));
        tree.set('key2', Buffer.from('value2'));
        tree.set('key3', Buffer.from('value3'));
        
        const proof = tree.generateProof('key2');
        
        // Tamper with an InnerOp if path exists
        if (proof.path.length > 0) {
          proof.path[0].suffix = Buffer.from('tampered-sibling');
          
          const isValid = tree.verifyProof(proof);
          expect(isValid).toBe(false);
        }
      });

      it('should verify proofs remain valid after tree modifications to other keys', () => {
        tree.set('key1', Buffer.from('value1'));
        tree.set('key2', Buffer.from('value2'));
        
        const proof1 = tree.generateProof('key1');
        
        // Modify tree by adding/removing other keys
        tree.set('key3', Buffer.from('value3'));
        
        // Original proof should now be invalid (root changed)
        const isValid = tree.verifyProof(proof1);
        expect(isValid).toBe(false);
        
        // But a new proof for the same key should be valid
        const newProof1 = tree.generateProof('key1');
        expect(tree.verifyProof(newProof1)).toBe(true);
      });
    });

    describe('Edge Cases', () => {
      it('should handle keys with special characters', () => {
        const specialKey = 'path/with/slashes/and-dashes_and_underscores';
        tree.set(specialKey, Buffer.from('data'));
        
        const proof = tree.generateProof(specialKey);
        expect(tree.verifyProof(proof)).toBe(true);
      });

      it('should handle binary values', () => {
        const binaryValue = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
        tree.set('binary-key', binaryValue);
        
        const proof = tree.generateProof('binary-key');
        expect(proof.value).toEqual(binaryValue);
        expect(tree.verifyProof(proof)).toBe(true);
      });

      it('should handle empty values', () => {
        const emptyValue = Buffer.alloc(0);
        tree.set('empty-key', emptyValue);
        
        const proof = tree.generateProof('empty-key');
        expect(proof.value).toEqual(emptyValue);
        expect(tree.verifyProof(proof)).toBe(true);
      });

      it('should handle large values', () => {
        const largeValue = Buffer.alloc(10000, 0xab);
        tree.set('large-key', largeValue);
        
        const proof = tree.generateProof('large-key');
        expect(proof.value).toEqual(largeValue);
        expect(tree.verifyProof(proof)).toBe(true);
      });
    });
  });
});

