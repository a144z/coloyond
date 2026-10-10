// One-off generator: folds the implemented `initialize_vault` accounts, one
// `VaultInit` argument, and the new `VaultInit`/`VaultInitialized` type entries
// into the checked-in IDL artifacts after the Rust change, keeping the
// snake_case JSON and its camelCased TS type mirror in sync.
// Run: node tools/rebalancing/patch-idl-init.mjs
import { readFileSync, writeFileSync } from "node:fs";

const PROGRAM_ID = "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6";
const VAULT_SEED = [...Buffer.from("vault")];
const GOVERNANCE_SEED = [...Buffer.from("governance")];
const AUCTION_POLICY_SEED = [...Buffer.from("auction_policy")];
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

const INIT_ACCOUNTS = [
  { name: "vault", writable: true, pda: { seeds: [{ kind: "const", value: VAULT_SEED }] } },
  { name: "governance", writable: true, pda: { seeds: [{ kind: "const", value: GOVERNANCE_SEED }, { kind: "account", path: "vault" }] } },
  { name: "auction_policy", writable: true, pda: { seeds: [{ kind: "const", value: AUCTION_POLICY_SEED }, { kind: "account", path: "vault" }] } },
  { name: "share_mint", writable: true },
  { name: "seeder", writable: true, signer: true },
  { name: "seeder_shares", writable: true },
  { name: "seeder_asset_a", writable: true },
  { name: "seeder_asset_b", writable: true },
  { name: "custody_a", writable: true },
  { name: "custody_b", writable: true },
  { name: "mint_a" },
  { name: "mint_b" },
  { name: "sol_usd" },
  { name: "usdc_usd" },
  { name: "token_program", address: TOKEN_PROGRAM },
  { name: "system_program", address: SYSTEM_PROGRAM },
];

const U64_ARRAY = { array: ["u64", 2] };
const U16_ARRAY = { array: ["u16", 2] };
const U8_ARRAY = { array: ["u8", 2] };
const VAULT_INIT_FIELDS = [
  ["configuration_revision", "u64"],
  ["target_bps", U16_ARRAY],
  ["seed_amounts", U64_ARRAY],
  ["reserve_contributions", U64_ARRAY],
  ["initial_shares", "u64"],
  ["minimum_locked_shares", "u64"],
  ["governance_authority", "pubkey"],
  ["emergency_authority", "pubkey"],
  ["min_delay_slots", "u64"],
  ["maximum_age_seconds", "u64"],
  ["maximum_confidence_bps", "u16"],
  ["maximum_usdc_deviation_bps", "u16"],
  ["minimum_drift_bps", "u16"],
  ["maximum_trade_value_q9", "u64"],
  ["cooldown_slots", "u64"],
  ["curve_start_rate_bps", "u16"],
  ["curve_end_rate_bps", "u16"],
  ["duration_slots", "u64"],
  ["fee_bps", "u16"],
  ["maximum_fee_bps", "u16"],
  ["maximum_bounty_per_fill", "u64"],
  ["maximum_nav_loss_bps", "u16"],
  ["maximum_cumulative_nav_loss_bps", "u16"],
  ["asset_feed_indices", U8_ARRAY],
];
const VAULT_INITIALIZED_FIELDS = [
  ["vault", "pubkey"],
  ["seeder", "pubkey"],
  ["configuration_revision", "u64"],
  ["seed_amounts", U64_ARRAY],
  ["reserve_contributions", U64_ARRAY],
  ["total_shares", "u64"],
];

function structType(fields) {
  return {
    kind: "struct",
    fields: fields.map(([name, type]) => ({ name, type })),
  };
}

function upsertType(idl, name, type) {
  const existing = idl.types.find((entry) => entry.name === name);
  if (existing) {
    existing.type = type;
    return;
  }
  const entry = { name, type };
  const index = idl.types.findIndex((candidate) => candidate.name.localeCompare(name) > 0);
  idl.types.splice(index < 0 ? idl.types.length : index, 0, entry);
}

function patch(idl) {
  const instruction = idl.instructions.find((entry) => entry.name === "initialize_vault" || entry.name === "initializeVault");
  if (!instruction) throw new Error("initialize_vault instruction is missing from the IDL");
  instruction.accounts = INIT_ACCOUNTS;
  instruction.args = [{ name: "init", type: { defined: { name: "VaultInit" } } }];
  upsertType(idl, "VaultInit", structType(VAULT_INIT_FIELDS));
  upsertType(idl, "VaultInitialized", structType(VAULT_INITIALIZED_FIELDS));
}

function camel(name) {
  return name
    .replace(/_(\w)/g, (_, character) => character.toUpperCase())
    .replace(/^./, (character) => character.toLowerCase());
}

function camelizeNames(value) {
  if (Array.isArray(value)) return value.map(camelizeNames);
  if (value === null || typeof value !== "object") return value;
  const result = {};
  for (const [key, inner] of Object.entries(value)) {
    result[key] = key === "name" && typeof inner === "string" ? camel(inner) : camelizeNames(inner);
  }
  return result;
}

const jsonPath = new URL("../../idl/coloyond_vault.json", import.meta.url);
const idl = JSON.parse(readFileSync(jsonPath, "utf-8"));
idl.address = PROGRAM_ID;
patch(idl);
writeFileSync(jsonPath, `${JSON.stringify(idl, undefined, 2)}\n`);

const tsPath = new URL("../../packages/coloyond-client/src/idl/coloyond_vault.ts", import.meta.url);
const header = `/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at \`target/idl/coloyond_vault.json\`.
 */
export type ColoyondVault = `;
writeFileSync(tsPath, `${header}${JSON.stringify(camelizeNames(idl), undefined, 2)};\n`);

// The regenerated files are the source of truth; assert they contain the fold.
const reread = JSON.parse(readFileSync(jsonPath, "utf-8"));
const rereadTs = readFileSync(tsPath, "utf-8");
console.log(
  "initialize_vault accounts:",
  reread.instructions.find((entry) => entry.name === "initialize_vault").accounts.length,
  "| arg defined:",
  reread.instructions.find((entry) => entry.name === "initialize_vault").args[0].type.defined.name,
  "| VaultInit in TS:",
  rereadTs.includes("VaultInit") || rereadTs.includes("vaultInit"),
);
console.log("program id folded into both artifacts:", reread.address === PROGRAM_ID && rereadTs.includes(PROGRAM_ID));
