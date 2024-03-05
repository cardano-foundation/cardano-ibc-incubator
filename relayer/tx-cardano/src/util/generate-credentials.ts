import { Lucid } from "lucid-cardano";
import fs from "fs"
import dotenv from "dotenv"
import { NETWORK } from "./constant";

dotenv.config({path: '.env'})

const oldPrivateKey = process.env.PRIVATE_KEY
const oldAddress = process.env.ADDRESS

// gen new private key and address 
const lucid = await Lucid.new(undefined, NETWORK);
const newPrivateKey = lucid.utils.generatePrivateKey();
const newAddress = await lucid.selectWalletFromPrivateKey(newPrivateKey).wallet.address();

// replace private key and address
let data = fs.readFileSync('.env', { encoding: 'utf8', flag: 'r' });

data = data.replace('PRIVATE_KEY=' + oldPrivateKey, 'PRIVATE_KEY=' + newPrivateKey)
data = data.replace('ADDRESS=' + oldAddress,'ADDRESS=' + newAddress)

fs.writeFileSync('.env', data)