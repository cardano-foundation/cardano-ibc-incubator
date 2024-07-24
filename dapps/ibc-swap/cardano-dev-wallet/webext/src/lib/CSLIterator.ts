interface CSLContainer<T> {
  len(): number;
  get(i: number): T;
}

class CSLIterator<T> implements Iterator<T>, Iterable<T> {
  private index: number;
  constructor(private container: CSLContainer<T> | undefined) {
    this.index = 0;
  }

  [Symbol.iterator](): Iterator<T> {
    return this;
  }

  next(): IteratorResult<T> {
    if (this.container != null && this.index < this.container.len()) {
      let val = {
        done: false,
        value: this.container.get(this.index),
      };
      this.index += 1;
      return val;
    } else {
      return {
        done: true,
        value: null,
      };
    }
  }
}

export { CSLIterator, type CSLContainer };
