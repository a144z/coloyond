// Coloyond Devnet Drift Loop (blueprint Phase 4, program side).
// The program is not deployed on Devnet yet, so this loop is read-only: it
// reports whether the vault program is live, decodes every Vault account it
// owns (the 353 byte layout is mirrored from the decoder in
// packages/coloyond-client/src/vaultDecoder.ts), reads both custody token
// balances and both pinned Pyth feeds, and prints the current weighted drift
// in basis points per asset against the vault's baked-in targets. When a
// keeper is wired up later, this is the number that decides fill_auction.
//
// Usage, from the repository root (env configured like the sibling probes):
//   npx tsx tools/rebalancing/coloyond-drift-loop.mjs
//   VAULT=<vault account base58>   optional; restricts the report to one vault
//   RPC_NODES="url,url,..."        rotation list; defaults to the two official endpoints
//   MAX_ROUNDS=n                   default 1; 0 runs forever
//   INTERVAL_MS=n                  default 85, the blueprint's pacing pause
import { Connection, PublicKey } from "@solana/web3.js";

const RPC_NODES = (process.env.RPC_NODES ?? "https://api.devnet.solana.com,https://api.mainnet-beta.solana.com")
  .split(",")
  .map((url) => url.trim())
  .filter((url) => url !== "");
const VAULT = process.env.VAULT ?? null;
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS ?? 1);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 85);

const PROGRAM_ID = new PublicKey("FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const VAULT_ACCOUNT_SIZE = 353;
const VAULT_DISCRIMINATOR = [211, 8, 232, 43, 2, 152, 117, 119];
const STATUSES = ["uninitialized", "active", "paused"];

// The oracle.rs pins. The verified feed accounts embed the feed ID at offset
// 41 (8 byte Anchor discriminator + 8 byte publish slot + 1 byte source tag),
// followed by the signed price, confidence, exponent, and publish time.
const FEEDS = [
  { label: "SOL/USD", account: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE" },
  { label: "USDC/USD", account: "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX" },
];
const FEED_ID_OFFSET = 41;

function dataView(account) {
  return new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength);
}

function readPrice(connection, feed) {
  return connection
    .getAccountInfo(new PublicKey(feed.account))
    .then((account) => {
      if (account === null) return { label: feed.label, price: null, note: "feed account absent on this cluster" };
      if (account.data.byteLength <= FEED_ID_OFFSET + 56) {
        return { label: feed.label, price: null, note: `feed account too small (${account.data.byteLength} bytes)` };
      }
      const view = dataView(account);
      const price = view.getInt64(FEED_ID_OFFSET + 32, true);
      const exponent = view.getInt32(FEED_ID_OFFSET + 48, true);
      const publishedAt = view.getBigUint64(FEED_ID_OFFSET + 52, true);
      const ageSeconds = Number(BigInt(Math.floor(Date.now() / 1000)) - publishedAt);
      return { label: feed.label, price: Number(price) * 10 ** exponent, note: `published ${ageSeconds}s ago` };
    });
}

function parseVault(account) {
  for (let index = 0; index < 8; index++) {
    if (account.data[index] !== VAULT_DISCRIMINATOR[index]) throw new Error("Vault account discriminator does not match the generated Anchor IDL");
  }
  if (account.data[8] !== 1) throw new Error(`Unsupported Vault account version ${account.data[8]}`);
  const view = dataView(account);
  const custodyOf = (assetIndex) => {
    const start = 51 + assetIndex * 99;
    return {
      custody: base58Of(account.data.subarray(start + 64, start + 96)),
      decimals: account.data[start + 96],
      targetBps: view.getUint16(start + 97, true),
    };
  };
  return {
    status: STATUSES[account.data[10]] ?? `unknown status ${account.data[10]}`,
    assets: [custodyOf(0), custodyOf(1)],
    totalShares: view.getBigUint64(281, true),
    sequence: view.getBigUint64(345, true),
  };
}

async function custodyBalance(connection, custody, decimals) {
  const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, [
    { memcmp: { offset: 32, bytes: custody, encoding: "base58" } },
    { dataSize: 165 },
  ]);
  if (accounts.length !== 1) return { raw: null, note: `${accounts.length} token accounts owned by this custody` };
  const view = dataView(accounts[0].account);
  return { raw: view.getBigUint64(64, true), decimals };
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Of(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (let index = zeros; index < bytes.length; index++) {
    let carry = bytes[index];
    for (let position = 0; position < digits.length; position++) {
      carry += digits[position] << 8;
      digits[position] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map((digit) => BASE58_ALPHABET[digit]).join("");
}

async function once(round) {
  const connection = new Connection(RPC_NODES[round % RPC_NODES.length], "confirmed");
  const program = await connection.getAccountInfo(PROGRAM_ID);
  if (program === null) {
    console.log(`[Coloyond Drift] Round #${round} via ${RPC_NODES[round % RPC_NODES.length]}: program is not deployed here yet.`);
    return;
  }
  console.log(`[Coloyond Drift] Round #${round} via ${RPC_NODES[round % RPC_NODES.length]}: program deployed (${program.data.byteLength} bytes of program data).`);
  const prices = await Promise.all(FEEDS.map((feed) => readPrice(connection, feed)));
  for (const price of prices) console.log(`  ${price.label}: ${price.price === null ? price.note : `${price.price} (${price.note})`}`);
  let entries;
  if (VAULT === null) {
    const found = await connection.getProgramAccounts(PROGRAM_ID, [{ dataSize: VAULT_ACCOUNT_SIZE }]);
    entries = found.map((entry) => ({ pubkey: entry.pubkey, account: entry.account }));
  } else {
    const pubkey = new PublicKey(VAULT);
    const account = await connection.getAccountInfo(pubkey);
    const usable = account !== null && account.owner.toBase58() === PROGRAM_ID.toBase58() && account.data.byteLength === VAULT_ACCOUNT_SIZE;
    entries = [{ pubkey, account: usable ? account : null }];
  }
  if (entries.length === 0) {
    console.log("  no Vault accounts are owned by the program on this cluster yet.");
    return;
  }
  for (const entry of entries) {
    const account = entry.account;
    if (account === null) {
      console.log(`  ${entry.pubkey.toBase58()}: missing, not owned by the program, or not ${VAULT_ACCOUNT_SIZE} bytes.`);
      continue;
    }
    const vault = parseVault(account);
    const pubkey = entry.pubkey;
    console.log(`  ${pubkey.toBase58()}: status ${vault.status}, total shares ${vault.totalShares}, sequence ${vault.sequence}.`);
    const values = [];
    for (let assetIndex = 0; assetIndex < 2; assetIndex++) {
      const custody = vault.assets[assetIndex];
      const balance = await custodyBalance(connection, custody.custody, custody.decimals);
      if (balance.raw === null) {
        values.push(null);
        console.log(`    custody ${custody.custody}: ${balance.note}`);
        continue;
      }
      const price = prices[assetIndex].price;
      if (price === null) {
        values.push(null);
        console.log(`    custody ${custody.custody}: price unavailable, cannot value ${balance.raw} raw units`);
        continue;
      }
      const value = Number(balance.raw) / 10 ** Number(balance.decimals) * price;
      values.push(value);
      console.log(`    custody ${custody.custody}: ${balance.raw} raw / ${balance.decimals} decimals -> ${value} USD against target ${custody.targetBps} bps.`);
    }
    const total = values[0] !== null && values[1] !== null ? values[0] + values[1] : null;
    if (total === null || total === 0) {
      console.log("    drift: not computable from these balances and prices.");
      continue;
    }
    const driftA = Math.abs(((values[0] / total) * 10000 - vault.assets[0].targetBps)).toFixed(1);
    const driftB = Math.abs(((values[1] / total) * 10000 - vault.assets[1].targetBps)).toFixed(1);
    console.log(`    drift: asset A ${driftA} bps, asset B ${driftB} bps off target.`);
  }
}

async function main() {
  let round = 0;
  while (MAX_ROUNDS === 0 || round < MAX_ROUNDS) {
    try {
      await once(round);
    } catch (error) {
      console.log(`Network congestion or rate limit hit (${error.message}). Rolling to next RPC node...`);
    }
    round++;
    if (round < MAX_ROUNDS || MAX_ROUNDS === 0) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  console.log(`Done: ${round} round(s), read-only; a later pass will submit fill_auction from this drift.`);
}

main();
