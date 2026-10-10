// Dev-only, read-only: dumps raw Symmetry V3 accounts and the pinned SDK's decode
// of them, so the Kotlin AccountDecoder can be checked against the SDK exactly.
// Usage: node dump-fixtures.mjs <outDir> <vaultPubkey>...
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Connection, PublicKey } from "@solana/web3.js";
const require = createRequire(import.meta.url);
const { VaultLayout } = require("@symmetry-hq/sdk/dist/layouts/basket.js");
const { GlobalConfigLayout } = require("@symmetry-hq/sdk/dist/layouts/config.js");
const { getGlobalConfigPda } = require("@symmetry-hq/sdk/dist/instructions/pda.js");
const sdkVersion = require("@symmetry-hq/sdk/package.json").version;

const conn = new Connection(process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
const [outDir, ...vaults] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

// Plain JSON: u64 as decimal strings, pubkeys as base58, byte arrays as number arrays.
function plain(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof PublicKey) return v.toBase58();
  if (typeof v.toBase58 === "function") return v.toBase58();
  if (typeof v === "bigint") return v.toString();
  if (v.constructor?.name === "BN" || (typeof v.toArrayLike === "function")) return v.toString(10);
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Array.from(v);
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

async function dump(name, pubkey, layout) {
  const info = await conn.getAccountInfo(new PublicKey(pubkey), "confirmed");
  if (!info) throw new Error(`missing account ${pubkey}`);
  const decoded = layout.decode(info.data.subarray(8));
  const fixture = {
    sdk: `@symmetry-hq/sdk@${sdkVersion}`,
    pubkey,
    owner: info.owner.toBase58(),
    dataLength: info.data.length,
    discriminator: Array.from(info.data.subarray(0, 8)),
    layoutSpan: layout.getSpan(),
    dataBase64: info.data.toString("base64"),
    decoded: plain(decoded),
  };
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(fixture) + "\n");
  console.log(`${name}: ${pubkey} ${info.data.length} bytes, span ${layout.getSpan()}`);
}

const globalPda = getGlobalConfigPda();
await dump("global-config", globalPda.toBase58(), GlobalConfigLayout);
for (const v of vaults) await dump(`vault-${v}`, v, VaultLayout);
