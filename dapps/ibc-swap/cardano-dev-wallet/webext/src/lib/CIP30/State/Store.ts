class HeirarchialStore {
  prefix: string[];
  backend: Store;

  constructor(backend: Store, prefix: string[] = []) {
    this.prefix = prefix;
    this.backend = backend;
  }

  get(key: string): Promise<any> {
    key = [...this.prefix, key].join("/");
    return this.backend.get(key);
  }

  set(key: string, value: any): Promise<void> {
    key = [...this.prefix, key].join("/");
    return this.backend.set(key, value);
  }

  withPrefix(...prefix: string[]): HeirarchialStore {
    return new HeirarchialStore(this.backend, [...this.prefix, ...prefix]);
  }
}

interface Store {
  set(key: string, value: any): Promise<void>;
  get(key: string): Promise<any>;
}


export {
  HeirarchialStore,
  type Store,
};
