// Read-only Devnet/Mainnet-beta probe for the two feeds pinned in
// programs/coloyond-vault/src/oracle.rs (blueprint phases 1-3 prerequisite).
//
// Reports, per pinned feed, whether the pinned account exists on each cluster,
// whether it is owned by the Pyth Receiver program, whether the pinned feed ID
// is embedded in its data (and at which offset), whether the account equals the
// feed-ID PDA of the receiver program, and which Devnet receiver-program
// accounts embed the pinned feed ID when the pinned account is absent there.
//
// Usage: npx tsx tools/rebalancing/verify-devnet-feeds.mjs
//   RPC_DEVNET / RPC_MAINNET override the cluster endpoints.
import { Connection, PublicKey } from "@solana/web3.js";

const RPC_DEVNET = process.env.RPC_DEVNET ?? "https://api.devnet.solana.com";
const RPC_MAINNET = process.env.RPC_MAINNET ?? "https://api.mainnet-beta.solana.com";
const RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SEARCH_CAP = 200;

// The oracle module's source-listed constants, copied verbatim.
const FEEDS = [
  {
    name: "SOL/USD",
    idHex: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    pinned: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
  },
  {
    name: "USDC/USD",
    idHex: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    pinned: "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX",
  },
];

function feedIdBytes(idHex) {
  const hex = idHex.startsWith("0x") ? idHex.slice(2) : idHex;
  if (hex.length !== 64) throw new Error(`${idHex} is not 32 bytes`);
  return Uint8Array.from(hex.match(/../g).map((pair) => Number.parseInt(pair, 16)));
}

function indexOfSequence(hay, needle) {
  outer: for (let start = 0; start + needle.length <= hay.length; start++) {
    for (let i = 0; i < needle.length; i++) if (hay[start + i] !== needle[i]) continue outer;
    return start;
  }
  return -1;
}

async function accountAt(connection, address) {
  try {
    const info = await connection.getAccountInfo(new PublicKey(address), "finalized");
    if (!info) return { exists: false };
    const data = Uint8Array.from(info.data.slice(0, 4096));
    return { exists: true, owner: info.owner.toBase58(), data };
  } catch (error) {
    return { exists: false, error: error.message };
  }
}

async function receiverAccountsEmbedding(connection, idBytes, dataSize) {
  const filters = dataSize === undefined ? [] : [{ dataSize }];
  const accounts = await connection.getProgramAccounts(RECEIVER, {
    commitment: "finalized",
    encoding: "base64",
    filters,
  });
  const matches = [];
  for (const item of accounts.slice(0, SEARCH_CAP)) {
    const data = Uint8Array.from(item.account.data.slice(0, 4096));
    const offset = indexOfSequence(data, idBytes);
    if (offset >= 0) matches.push({ address: item.pubkey.toBase58(), data, offset });
  }
  return { total: accounts.length, matches };
}

const devnet = new Connection(RPC_DEVNET, "confirmed");
const mainnet = new Connection(RPC_MAINNET, "confirmed");

for (const feed of FEEDS) {
  const idBytes = feedIdBytes(feed.idHex);
  const derived = PublicKey.findProgramAddressSync([idBytes], RECEIVER)[0].toBase58();
  console.log(`\n=== ${feed.name} pinned=${feed.pinned}`);
  console.log(`  feed id is ${idBytes.length} bytes; receiver PDA of that id = ${derived} ${derived === feed.pinned ? "(== pinned)" : "(!= pinned)"}`);

  const main = await accountAt(mainnet, feed.pinned);
  console.log(`  mainnet-beta pinned account: ${describe(main, idBytes)}`);
  const dev = await accountAt(devnet, feed.pinned);
  console.log(`  devnet pinned account:       ${describe(dev, idBytes)}`);

  if (dev.exists && dev.owner === RECEIVER.toBase58()) continue;
  const dataSize = main.exists ? main.data.length : undefined;
  const search = await receiverAccountsEmbedding(devnet, idBytes, dataSize);
  console.log(`  devnet receiver accounts${dataSize === undefined ? "" : ` with that data size`}: ${search.total} scanned, embedding pinned id: ${search.matches.length ? search.matches.map((m) => `${m.address}@${m.offset}`).join(", ") : "none"}`);
}

function describe(account, idBytes) {
  if (account.error) return `RPC error: ${account.error}`;
  if (!account.exists) return "absent";
  const offset = indexOfSequence(account.data, idBytes);
  return `exists, owner=${account.owner}, data=${account.data.length} bytes (truncated), pinned id ${offset < 0 ? "NOT embedded" : `embedded at offset ${offset}`}`;
}
