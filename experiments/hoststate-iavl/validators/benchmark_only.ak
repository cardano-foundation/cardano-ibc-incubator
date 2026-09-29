use aiken/collection/list
use bucket
// Cost/size harness only. Roots here are redeemer inputs, not authenticated
// chain state. This script MUST NOT be deployed as a HostState validator.
use cardano/transaction.{OutputReference, Transaction}
use iavl.{Tree}
use sparse_baseline

pub type IavlUpdate {
  old_root: ByteArray,
  new_root: ByteArray,
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  version: Int,
  index: Int,
  witness: Tree,
}

pub type SparseUpdate {
  old_root: ByteArray,
  new_root: ByteArray,
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  siblings: List<ByteArray>,
}

pub type BucketUpdate {
  old_root: ByteArray,
  new_root: ByteArray,
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  witness: bucket.CompressedWitness,
}

validator bucket_update {
  spend(
    _datum: Option<Data>,
    update: BucketUpdate,
    _ref: OutputReference,
    _tx: Transaction,
  ) {
    bucket.apply_compressed_update(
      update.old_root,
      update.key,
      update.old_value,
      update.new_value,
      update.witness,
    ) == update.new_root
  }

  else(_) {
    fail
  }
}

validator iavl_update {
  spend(
    _datum: Option<Data>,
    update: IavlUpdate,
    _ref: OutputReference,
    _tx: Transaction,
  ) {
    iavl.apply_update(
      update.old_root,
      update.key,
      update.old_value,
      update.new_value,
      update.version,
      update.index,
      update.witness,
    ) == update.new_root
  }

  else(_) {
    fail
  }
}

validator sparse_update {
  spend(
    _datum: Option<Data>,
    update: SparseUpdate,
    _ref: OutputReference,
    _tx: Transaction,
  ) {
    sparse_baseline.apply_update(
      update.old_root,
      update.key,
      update.old_value,
      update.new_value,
      update.siblings,
    ) == update.new_root
  }

  else(_) {
    fail
  }
}

pub type IavlChange {
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  index: Int,
  witness: Tree,
}

pub type IavlBatch {
  old_root: ByteArray,
  new_root: ByteArray,
  version: Int,
  changes: List<IavlChange>,
}

pub type BucketChange {
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  witness: bucket.CompressedWitness,
}

pub type BucketBatch {
  old_root: ByteArray,
  new_root: ByteArray,
  changes: List<BucketChange>,
}

pub type SparseChange {
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  siblings: List<ByteArray>,
}

pub type SparseBatch {
  old_root: ByteArray,
  new_root: ByteArray,
  changes: List<SparseChange>,
}

validator iavl_batch {
  spend(
    _datum: Option<Data>,
    batch: IavlBatch,
    _ref: OutputReference,
    _tx: Transaction,
  ) {
    list.foldl(
      batch.changes,
      batch.old_root,
      fn(update, root) {
        iavl.apply_update(
          root,
          update.key,
          update.old_value,
          update.new_value,
          batch.version,
          update.index,
          update.witness,
        )
      },
    ) == batch.new_root
  }

  else(_) {
    fail
  }
}

validator bucket_batch {
  spend(
    _datum: Option<Data>,
    batch: BucketBatch,
    _ref: OutputReference,
    _tx: Transaction,
  ) {
    list.foldl(
      batch.changes,
      batch.old_root,
      fn(update, root) {
        bucket.apply_compressed_update(
          root,
          update.key,
          update.old_value,
          update.new_value,
          update.witness,
        )
      },
    ) == batch.new_root
  }

  else(_) {
    fail
  }
}

validator sparse_batch {
  spend(
    _datum: Option<Data>,
    batch: SparseBatch,
    _ref: OutputReference,
    _tx: Transaction,
  ) {
    list.foldl(
      batch.changes,
      batch.old_root,
      fn(update, root) {
        sparse_baseline.apply_update(
          root,
          update.key,
          update.old_value,
          update.new_value,
          update.siblings,
        )
      },
    ) == batch.new_root
  }

  else(_) {
    fail
  }
}
