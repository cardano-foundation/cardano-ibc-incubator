import borc from "npm:borc@5";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

const hostStateInner = [
  0,  
  hexToBytes("0000000000000000000000000000000000000000000000000000000000000000"),  
  0,  
  0,  
  0,  
  [],  
  Number(Date.now()),  
];
const innerConstructor = new borc.Tagged(121, hostStateInner);
const outerArray = [
  innerConstructor,
  hexToBytes("b9b815c318ca18ce82e09c60fa892402e884d92c0117596d187ad1c9"),
];
const outerConstructor = new borc.Tagged(121, outerArray);
const final = borc.encode(outerConstructor);
console.log("Borc Final:", final.toString('hex'));
