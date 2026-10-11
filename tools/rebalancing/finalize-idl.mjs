// Finalize the generated Anchor IDL with the program ID declared in source.
// Anchor's `idl build` leaves `address` blank when the deploy keypair does not
// match `declare_id!`; this script refuses mismatched workspace IDs and keeps
// the JSON/TypeScript mirrors byte-for-byte aligned apart from casing.
import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("../../programs/coloyond-vault/src/lib.rs", import.meta.url), "utf8");
const anchorToml = readFileSync(new URL("../../Anchor.toml", import.meta.url), "utf8");
const declaredId = source.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/)?.[1];
if (!declaredId) throw new Error("Could not read the Coloyond program ID from declare_id!.");

const configuredIds = [...anchorToml.matchAll(/^coloyond_vault\s*=\s*"([^"]+)"\s*$/gm)].map((match) => match[1]);
if (configuredIds.length < 2 || configuredIds.some((id) => id !== declaredId)) {
  throw new Error("Anchor.toml program IDs must match the program's declare_id! for every configured cluster.");
}

const jsonPath = new URL("../../idl/coloyond_vault.json", import.meta.url);
const idl = JSON.parse(readFileSync(jsonPath, "utf8"));
if (idl.metadata?.name !== "coloyond_vault") throw new Error("Generated IDL is not for coloyond_vault.");
idl.address = declaredId;
writeFileSync(jsonPath, `${JSON.stringify(idl, null, 2)}\n`);

function camel(name) {
  return name.replace(/_(\w)/g, (_, character) => character.toUpperCase()).replace(/^./, (character) => character.toLowerCase());
}

function camelizeNames(value) {
  if (Array.isArray(value)) return value.map(camelizeNames);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [
    key,
    key === "name" && typeof inner === "string" ? camel(inner) : camelizeNames(inner),
  ]));
}

const header = `/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at \`target/idl/coloyond_vault.json\`.
 */
export type ColoyondVault = `;
const tsPath = new URL("../../packages/coloyond-client/src/idl/coloyond_vault.ts", import.meta.url);
writeFileSync(tsPath, `${header}${JSON.stringify(camelizeNames(idl), null, 2)};\n`);
console.log(`Finalized JSON and TypeScript IDLs for ${declaredId}.`);
