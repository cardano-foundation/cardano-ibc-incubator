export class TokenAsset {
  name: string;
  quantity: bigint;
  constructor(name: string, quantity: bigint) {
    this.name = name;
    this.quantity = quantity;
  }
}
