// Read-only Devnet diagnostic. It never signs or submits a transaction.
// The local limits below are required operator inputs, not approved protocol policy.
// Set RPC_URL, EXPECTED_GENESIS_HASH, MAX_FEED_AGE_SECONDS, MAX_CONFIDENCE_BPS,
// and MAX_USDC_DEVIATION_BPS. Missing values leave all price-dependent output unknown.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6";
export const DEVNET_GENESIS_HASH = "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const UPGRADEABLE_LOADER_ID = "BPFLoaderUpgradeab1e11111111111111111111111";
export const PYTH_RECEIVER_ID = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const VAULT_DISCRIMINATOR = Uint8Array.of(211, 8, 232, 43, 2, 152, 117, 119);
export const PYTH_DISCRIMINATOR = createHash("sha256").update("account:PriceUpdateV2").digest().subarray(0, 8);
export const VAULT_ACCOUNT_SIZE = 353;
export const PRICE_UPDATE_V2_SIZE = 134;

const COMMITMENT = "confirmed";
const PINNED_FEEDS = {
  sol: {
    label: "SOL/USD",
    address: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
    id: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  },
  usdc: {
    label: "USDC/USD",
    address: "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX",
    id: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  },
};
const CLOCK_SYSVAR_ID = "SysvarC1ock11111111111111111111111111111111";

function viewOf(data) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function readPubkey(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

export function requireAccount(account, label) {
  if (account === null || account === undefined) throw new Error(`${label} account is missing`);
  return account;
}

export function validateRuntimeConfig(env = process.env) {
  const rpcUrl = env.RPC_URL?.trim();
  if (!rpcUrl) throw new Error("RPC_URL is required; this diagnostic never rotates endpoints");
  let parsedUrl;
  try { parsedUrl = new URL(rpcUrl); } catch { throw new Error("RPC_URL must be an absolute HTTP(S) URL"); }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error("RPC_URL must use HTTP or HTTPS");
  if (env.EXPECTED_GENESIS_HASH !== DEVNET_GENESIS_HASH) {
    throw new Error(`EXPECTED_GENESIS_HASH must exactly match pinned Devnet genesis ${DEVNET_GENESIS_HASH}`);
  }
  const maxAgeSeconds = parseBound(env.MAX_FEED_AGE_SECONDS, "MAX_FEED_AGE_SECONDS", (1n << 63n) - 1n);
  const maxConfidenceBps = parseBound(env.MAX_CONFIDENCE_BPS, "MAX_CONFIDENCE_BPS", 10_000n);
  const maxUsdcDeviationBps = parseBound(env.MAX_USDC_DEVIATION_BPS, "MAX_USDC_DEVIATION_BPS", 10_000n);
  const maxRounds = parseSafeInteger(env.MAX_ROUNDS ?? "1", "MAX_ROUNDS", 0);
  const intervalMs = parseSafeInteger(env.INTERVAL_MS ?? "15000", "INTERVAL_MS", 250);
  return { rpcUrl, expectedVault: env.VAULT?.trim() || null, maxAgeSeconds, maxConfidenceBps, maxUsdcDeviationBps, maxRounds, intervalMs };
}

function parseBound(value, name, maximum) {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${name} is required as a non-negative integer; no policy default is assumed`);
  const parsed = BigInt(value);
  if (maximum !== undefined && parsed > maximum) throw new Error(`${name} exceeds ${maximum}`);
  return parsed;
}

function parseSafeInteger(value, name, minimum) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} must be at least ${minimum} and within the safe integer range`);
  return parsed;
}

export function validateGenesis(actualGenesis, expectedGenesis = DEVNET_GENESIS_HASH) {
  if (expectedGenesis !== DEVNET_GENESIS_HASH) throw new Error(`Expected genesis is not the pinned Devnet genesis ${DEVNET_GENESIS_HASH}`);
  if (actualGenesis !== expectedGenesis) throw new Error(`RPC genesis mismatch: got ${actualGenesis}, expected ${expectedGenesis}`);
  return true;
}

export function deriveCanonicalVault(programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from("vault")], new PublicKey(programId))[0].toBase58();
}

export function deriveProgramDataAddress(programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(programId).toBuffer()],
    new PublicKey(UPGRADEABLE_LOADER_ID),
  )[0].toBase58();
}

export function verifyUpgradeableProgram({ programId, expectedProgramId = PROGRAM_ID, program, programData, programDataAddress }) {
  if (programId !== expectedProgramId || expectedProgramId !== PROGRAM_ID) throw new Error("Program address does not match the pinned expected program ID");
  if (program.owner !== UPGRADEABLE_LOADER_ID || program.executable !== true) throw new Error("Program account has the wrong owner or is not executable");
  const programBytes = program.data;
  if (programBytes.byteLength !== 36 || viewOf(programBytes).getUint32(0, true) !== 2) throw new Error("Program account is not a valid Upgradeable Loader Program state");
  const referencedProgramData = readPubkey(programBytes, 4);
  if (referencedProgramData !== programDataAddress) throw new Error("Program state points to a different ProgramData account");
  const expectedProgramData = deriveProgramDataAddress();
  if (programDataAddress !== expectedProgramData) throw new Error("ProgramData address is not canonical for the pinned program");
  if (programData.owner !== UPGRADEABLE_LOADER_ID || programData.executable === true) throw new Error("ProgramData account has the wrong owner or executable flag");
  const data = programData.data;
  if (data.byteLength < 13 || viewOf(data).getUint32(0, true) !== 3) throw new Error("ProgramData account is not a valid Upgradeable Loader ProgramData state");
  const authorityOption = data[12];
  if (authorityOption !== 0 && authorityOption !== 1) throw new Error("ProgramData upgrade-authority option is malformed");
  if (authorityOption === 1 && data.byteLength < 45) throw new Error("ProgramData upgrade-authority key is truncated");
  return { programId, programDataAddress, upgradeAuthority: authorityOption === 1 ? readPubkey(data, 13) : null };
}

export function parseVault(data) {
  if (data.byteLength !== VAULT_ACCOUNT_SIZE) throw new Error(`Vault account must contain exactly ${VAULT_ACCOUNT_SIZE} bytes`);
  if (!VAULT_DISCRIMINATOR.every((byte, index) => data[index] === byte)) throw new Error("Vault account discriminator is invalid");
  const view = viewOf(data);
  let offset = 8;
  const version = view.getUint8(offset++);
  const bump = view.getUint8(offset++);
  const statusCode = view.getUint8(offset++);
  if (version !== 1) throw new Error(`Unsupported Vault version ${version}`);
  if (statusCode > 2) throw new Error(`Unsupported Vault status ${statusCode}`);
  const authority = readPubkey(data, offset); offset += 32;
  const configurationRevision = view.getBigUint64(offset, true); offset += 8;
  const assets = [];
  for (let index = 0; index < 2; index++) {
    const mint = readPubkey(data, offset); offset += 32;
    const tokenProgram = readPubkey(data, offset); offset += 32;
    const custody = readPubkey(data, offset); offset += 32;
    const decimals = view.getUint8(offset++);
    const targetBps = view.getUint16(offset, true); offset += 2;
    assets.push({ mint, tokenProgram, custody, decimals, targetBps });
  }
  const shareMint = readPubkey(data, offset); offset += 32;
  const totalShares = view.getBigUint64(offset, true); offset += 8;
  const minimumLockedShares = view.getBigUint64(offset, true); offset += 8;
  const accountedAmounts = [view.getBigUint64(offset, true), view.getBigUint64(offset + 8, true)]; offset += 16;
  const bootstrapReserve = [view.getBigUint64(offset, true), view.getBigUint64(offset + 8, true)]; offset += 16;
  const bountyLiabilities = [view.getBigUint64(offset, true), view.getBigUint64(offset + 8, true)]; offset += 16;
  const sequence = view.getBigUint64(offset, true); offset += 8;
  if (offset !== data.byteLength) throw new Error("Vault parser layout does not match the account size");
  if (assets[0].targetBps === 0 || assets[1].targetBps === 0 || assets[0].targetBps + assets[1].targetBps !== 10_000) throw new Error("Vault target weights are invalid");
  return {
    version, bump, status: ["uninitialized", "active", "paused"][statusCode], authority,
    configurationRevision, assets, shareMint, totalShares, minimumLockedShares,
    accountedAmounts, bootstrapReserve, bountyLiabilities, sequence,
  };
}

export function feedForMint(mint) {
  if (mint === WSOL_MINT) return PINNED_FEEDS.sol;
  if (mint === DEVNET_USDC_MINT) return PINNED_FEEDS.usdc;
  throw new Error(`Unsupported Devnet asset mint ${mint}`);
}

export function feedsForAssets(assets) {
  if (!Array.isArray(assets) || assets.length !== 2) throw new Error("Vault must contain exactly two assets");
  if (assets[0].mint === assets[1].mint) throw new Error("Vault asset mints must be distinct");
  return assets.map((asset, index) => {
    const feed = feedForMint(asset.mint);
    const expectedDecimals = asset.mint === WSOL_MINT ? 9 : 6;
    if (asset.decimals !== expectedDecimals) throw new Error(`Asset ${index} has unsupported decimals for ${asset.mint}`);
    if (asset.tokenProgram !== TOKEN_PROGRAM_ID) throw new Error(`Asset ${index} is not configured for the classic SPL Token Program`);
    return feed;
  });
}

export function validateCustodyAccount({ data, accountOwner, accountAddress, expectedCustodyAddress, mint, expectedAuthority, expectedAmount }) {
  if (accountAddress !== expectedCustodyAddress) throw new Error("Fetched custody address differs from Vault configuration");
  if (accountOwner !== TOKEN_PROGRAM_ID) throw new Error("Custody account is not owned by the classic SPL Token Program");
  if (data.byteLength !== 165) throw new Error(`Classic SPL custody account must contain 165 bytes, got ${data.byteLength}`);
  if (data[108] !== 1) throw new Error("Custody token account is not initialized or is frozen");
  const accountMint = readPubkey(data, 0);
  const tokenAuthority = readPubkey(data, 32);
  if (accountMint !== mint) throw new Error("Custody token account mint does not match Vault configuration");
  if (tokenAuthority !== expectedAuthority) throw new Error("Custody token authority does not match the canonical Vault PDA");
  const amount = viewOf(data).getBigUint64(64, true);
  if (expectedAmount !== undefined && amount !== expectedAmount) throw new Error("Custody token balance differs from the Vault accounted amount");
  return { amount, mint: accountMint, authority: tokenAuthority };
}

export function decodePythFullPrice({ data, accountOwner, accountAddress, expectedFeed, nowUnix, maxAgeSeconds, maxConfidenceBps, maxUsdcDeviationBps }) {
  // Borsh offsets are pinned to pyth-solana-receiver-sdk 1.2.0 PriceUpdateV2:
  // Full=1 at 40, PriceFeedMessage at 41, then price/conf/exponent/publish_time.
  if (accountAddress !== expectedFeed.address) throw new Error(`${expectedFeed.label} feed account address does not match the pinned account`);
  if (accountOwner !== PYTH_RECEIVER_ID) throw new Error(`${expectedFeed.label} feed owner is not the pinned Pyth Receiver`);
  if (data.byteLength !== PRICE_UPDATE_V2_SIZE) throw new Error(`${expectedFeed.label} PriceUpdateV2 must contain exactly ${PRICE_UPDATE_V2_SIZE} bytes`);
  if (!PYTH_DISCRIMINATOR.every((byte, index) => data[index] === byte)) throw new Error(`${expectedFeed.label} account discriminator is not PriceUpdateV2`);
  const view = viewOf(data);
  const verification = data[40];
  if (verification !== 1) throw new Error(`${expectedFeed.label} verification is not Full`);
  const feedId = `0x${Buffer.from(data.subarray(41, 73)).toString("hex")}`;
  if (feedId !== expectedFeed.id) throw new Error(`${expectedFeed.label} feed ID does not match the pinned ID`);
  const price = view.getBigInt64(73, true);
  const confidence = view.getBigUint64(81, true);
  const exponent = view.getInt32(89, true);
  const publishTime = view.getBigInt64(93, true);
  if (price <= 0n) throw new Error(`${expectedFeed.label} price is not positive`);
  if (exponent < -18 || exponent > 18) throw new Error(`${expectedFeed.label} exponent is outside the exact diagnostic range [-18, 18]`);
  const now = BigInt(nowUnix);
  if (publishTime > now) throw new Error(`${expectedFeed.label} publish time is in the future`);
  const ageSeconds = now - publishTime;
  if (ageSeconds > maxAgeSeconds) throw new Error(`${expectedFeed.label} data is stale (${ageSeconds}s exceeds ${maxAgeSeconds}s)`);
  if (confidence * 10_000n > price * maxConfidenceBps) throw new Error(`${expectedFeed.label} confidence interval exceeds the supplied diagnostic bound`);
  const confidenceBpsCeil = (confidence * 10_000n + price - 1n) / price;
  let depegBpsCeil = null;
  if (expectedFeed.label === "USDC/USD") {
    const denominator = exponent < 0 ? 10n ** BigInt(-exponent) : 1n;
    const numerator = exponent > 0 ? price * 10n ** BigInt(exponent) : price;
    const deviation = numerator >= denominator ? numerator - denominator : denominator - numerator;
    if (deviation * 10_000n > denominator * maxUsdcDeviationBps) throw new Error("USDC/USD price exceeds the supplied diagnostic depeg bound");
    depegBpsCeil = (deviation * 10_000n + denominator - 1n) / denominator;
  }
  return { feedId, price, confidence, exponent, publishTime, ageSeconds, confidenceBpsCeil, depegBpsCeil };
}

export function calculateObservedDrift(assets, balances, prices) {
  if (assets.length !== 2 || balances.length !== 2 || prices.length !== 2) throw new Error("Drift calculation requires exactly two ordered assets, balances and prices");
  if (assets[0].targetBps + assets[1].targetBps !== 10_000) throw new Error("Drift calculation requires valid 10,000 bps target weights");
  const valuesQ27 = assets.map((asset, index) => {
    const expectedDecimals = asset.mint === WSOL_MINT ? 9 : asset.mint === DEVNET_USDC_MINT ? 6 : null;
    if (asset.decimals !== expectedDecimals) throw new Error(`Asset ${index} is not an allowed Devnet mint/decimal pair`);
    if (typeof balances[index] !== "bigint" || balances[index] < 0n || balances[index] > (1n << 64n) - 1n) throw new Error(`Asset ${index} balance is outside the SPL u64 range`);
    if (typeof prices[index].price !== "bigint" || prices[index].price <= 0n || prices[index].price > (1n << 63n) - 1n) throw new Error(`Asset ${index} price is outside the positive Pyth i64 range`);
    if (prices[index].exponent < -18 || prices[index].exponent > 18) throw new Error(`Asset ${index} price exponent is outside the exact diagnostic range`);
    const shift = prices[index].exponent + 27 - asset.decimals;
    if (!Number.isInteger(shift) || shift < 0 || shift > 45) throw new Error("Price exponent cannot be represented exactly in Q27");
    return balances[index] * prices[index].price * 10n ** BigInt(shift);
  });
  const total = valuesQ27[0] + valuesQ27[1];
  if (total === 0n) throw new Error("Cannot calculate drift for zero total custody value");
  const driftsHundredthsBps = assets.map((asset, index) => {
    const weightedDelta = valuesQ27[index] * 10_000n - BigInt(asset.targetBps) * total;
    const absolute = weightedDelta < 0n ? -weightedDelta : weightedDelta;
    return (absolute * 100n + total / 2n) / total;
  });
  return { valuesQ27, driftsHundredthsBps };
}

export function formatHundredths(value) {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

function parseClockUnix(account) {
  const data = account.data;
  if (account.owner.toBase58() !== "Sysvar1111111111111111111111111111111111111" || data.byteLength !== 40) throw new Error("Clock sysvar account owner or layout is invalid");
  return viewOf(data).getBigInt64(32, true);
}

async function once(round, config) {
  const connection = new Connection(config.rpcUrl, COMMITMENT);
  const genesis = await connection.getGenesisHash();
  validateGenesis(genesis);
  const vaultAddress = deriveCanonicalVault();
  if (config.expectedVault && config.expectedVault !== vaultAddress) throw new Error(`VAULT must be the canonical PDA ${vaultAddress}`);
  const initialVault = requireAccount(await connection.getAccountInfo(new PublicKey(vaultAddress), COMMITMENT), "Canonical Vault");
  if (initialVault.owner.toBase58() !== PROGRAM_ID) throw new Error("Canonical Vault is not owned by the pinned program");
  const initialVaultData = Uint8Array.from(initialVault.data);
  const vault = parseVault(initialVaultData);
  const feeds = feedsForAssets(vault.assets);
  const programDataAddress = deriveProgramDataAddress();
  const keys = [
    PROGRAM_ID,
    programDataAddress,
    vaultAddress,
    CLOCK_SYSVAR_ID,
    ...feeds.map((feed) => feed.address),
    ...vault.assets.map((asset) => asset.custody),
  ].map((address) => new PublicKey(address));
  const { context, value: accounts } = await connection.getMultipleAccountsInfoAndContext(keys, COMMITMENT);
  try {
    const [programAccount, programDataAccount, vaultAccount, clockAccount, ...remaining] = accounts;
    const feedAccounts = remaining.slice(0, 2);
    const custodyAccounts = remaining.slice(2);
    const program = verifyUpgradeableProgram({
      programId: PROGRAM_ID,
      program: requireAccount(programAccount, "Program"),
      programData: requireAccount(programDataAccount, "ProgramData"),
      programDataAddress,
    });
    requireAccount(vaultAccount, "Canonical Vault");
    if (vaultAccount.owner.toBase58() !== PROGRAM_ID) throw new Error("Canonical Vault is not owned by the pinned program");
    if (vaultAccount.data.byteLength !== initialVaultData.byteLength || !vaultAccount.data.every((byte, index) => byte === initialVaultData[index])) {
      throw new Error("Vault changed while the diagnostic snapshot was being assembled");
    }
    const clockInfo = requireAccount(clockAccount, "Clock sysvar");
    const nowUnix = parseClockUnix(clockInfo);
    const prices = [];
    for (let index = 0; index < feeds.length; index++) {
      const feed = feeds[index];
      const account = requireAccount(feedAccounts[index], `${feed.label} feed`);
      prices.push(decodePythFullPrice({
        data: account.data,
        accountOwner: account.owner.toBase58(),
        accountAddress: feed.address,
        expectedFeed: feed,
        nowUnix,
        maxAgeSeconds: config.maxAgeSeconds,
        maxConfidenceBps: config.maxConfidenceBps,
        maxUsdcDeviationBps: config.maxUsdcDeviationBps,
      }));
    }
    const balances = [];
    for (let index = 0; index < vault.assets.length; index++) {
      const asset = vault.assets[index];
      const account = requireAccount(custodyAccounts[index], `Asset ${index} custody`);
      balances.push(validateCustodyAccount({
        data: account.data,
        accountOwner: account.owner.toBase58(),
        accountAddress: asset.custody,
        expectedCustodyAddress: asset.custody,
        mint: asset.mint,
        expectedAuthority: vaultAddress,
        expectedAmount: vault.accountedAmounts[index],
      }).amount);
    }
    const drift = calculateObservedDrift(vault.assets, balances, prices);
    console.log(`[S0B read-only diagnostic] round ${round + 1}; Devnet genesis verified; confirmed slot ${context.slot}; program ${program.programId}; no transaction submitted.`);
    console.log(`  Vault ${vaultAddress}: ${vault.status}, revision ${vault.configurationRevision}, sequence ${vault.sequence}.`);
    console.log(`  Diagnostic only: drift is not auction eligibility or portfolio NAV. Local bounds (not on-chain policy; no trigger): age ${config.maxAgeSeconds}s, confidence ${config.maxConfidenceBps} bps, USDC deviation ${config.maxUsdcDeviationBps} bps.`);
    for (let index = 0; index < 2; index++) {
      console.log(`  ${feeds[index].label}: price=${prices[index].price}e${prices[index].exponent}, age=${prices[index].ageSeconds}s, confidence<=${formatHundredths(prices[index].confidenceBpsCeil * 100n)}bps${prices[index].depegBpsCeil === null ? "" : `, depeg<=${formatHundredths(prices[index].depegBpsCeil * 100n)}bps`}.`);
      console.log(`  Asset ${index} ${assetName(vault.assets[index].mint)}: ${balances[index]} raw units, target ${vault.assets[index].targetBps} bps, observed absolute drift ${formatHundredths(drift.driftsHundredthsBps[index])} bps.`);
    }
  } catch (error) {
    const diagnosticError = new Error(error instanceof Error ? error.message : String(error), { cause: error });
    diagnosticError.confirmedSlot = context.slot;
    throw diagnosticError;
  }
}

function assetName(mint) {
  return mint === WSOL_MINT ? "WSOL" : mint === DEVNET_USDC_MINT ? "Devnet USDC" : mint;
}

export async function main(env = process.env) {
  const config = validateRuntimeConfig(env);
  let round = 0;
  while (config.maxRounds === 0 || round < config.maxRounds) {
    try {
      await once(round, config);
    } catch (error) {
      const slot = error && typeof error === "object" ? error.confirmedSlot ?? "unavailable" : "unavailable";
      console.error(`[S0B read-only diagnostic] round ${round + 1}; confirmed slot ${slot}; bounds age=${config.maxAgeSeconds}s/confidence=${config.maxConfidenceBps}bps/USDC-deviation=${config.maxUsdcDeviationBps}bps (local only); affected values are unknown: ${error instanceof Error ? error.message : String(error)}. No endpoint failover or transaction submission.`);
      if (config.maxRounds !== 0 && config.maxRounds === 1) process.exitCode = 1;
    }
    round++;
    if (config.maxRounds === 0 || round < config.maxRounds) await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[S0B read-only diagnostic] confirmed slot unavailable; configuration failed closed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
