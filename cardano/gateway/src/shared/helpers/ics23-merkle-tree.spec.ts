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
});

