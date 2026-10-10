import type { EtfReadModelFixtureDocument } from "./dto.js";

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const I32_MIN = -2_147_483_648;
const I32_MAX = 2_147_483_647;
const UNSIGNED = /^(?:0|[1-9][0-9]*)$/;
const SIGNED = /^(?:0|-?[1-9][0-9]*)$/;
const REASON = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const observationStatuses = new Set(["available", "stale", "unavailable", "invalid", "not_configured"]);
const receiptStatuses = new Set(["draft", "awaiting_signature", "submitted", "confirmed", "rejected", "unknown"]);

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${path}: expected non-empty string`);
    return false;
  }
  return true;
}

function integerString(
  value: unknown,
  path: string,
  errors: string[],
  signed = false,
  minimum = 0n,
  maximum = U64_MAX,
): value is string {
  const pattern = signed ? SIGNED : UNSIGNED;
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(`${path}: expected base-10 integer string`);
    return false;
  }
  const parsed = BigInt(value);
  if (parsed < minimum || parsed > maximum) {
    errors.push(`${path}: integer string is outside the supported wire range`);
    return false;
  }
  return true;
}

function requiredText(record: UnknownRecord, fields: string[], path: string, errors: string[]): void {
  for (const field of fields) text(record[field], `${path}.${field}`, errors);
}

function validateOracle(oracle: UnknownRecord, path: string, errors: string[]): void {
  const mode = oracle.mode;
  if (mode !== "receiver_full" && mode !== "push_feed") {
    errors.push(`${path}.mode: unsupported oracle mode`);
    return;
  }
  requiredText(oracle, ["account", "owner", "feedId"], path, errors);
  integerString(oracle.rawPrice, `${path}.rawPrice`, errors, false, 1n, I64_MAX);
  integerString(oracle.confidence, `${path}.confidence`, errors);
  integerString(oracle.publishTime, `${path}.publishTime`, errors, true, I64_MIN, I64_MAX);
  integerString(oracle.ageSeconds, `${path}.ageSeconds`, errors);
  if (
    typeof oracle.exponent !== "number" || !Number.isInteger(oracle.exponent) ||
    oracle.exponent < I32_MIN || oracle.exponent > I32_MAX
  ) errors.push(`${path}.exponent: expected signed i32 JSON number`);

  if (mode === "receiver_full") {
    if (oracle.verification !== "full") errors.push(`${path}.verification: receiver_full requires full verification`);
    if ("accountStatus" in oracle) errors.push(`${path}.accountStatus: receiver_full must use verification, not push-feed status`);
  } else {
    if ("verification" in oracle) errors.push(`${path}.verification: push_feed must not invent a Receiver verification field`);
    text(oracle.accountStatus, `${path}.accountStatus`, errors);
  }
}

function validateSnapshot(fixture: UnknownRecord, path: string, errors: string[]): void {
  const network = fixture.network;
  if (!isRecord(network)) {
    errors.push(`${path}.network: expected object`);
    return;
  }
  requiredText(network, ["cluster", "genesisHash", "rpcLabel"], `${path}.network`, errors);
  integerString(network.contextSlot, `${path}.network.contextSlot`, errors);
  if (!["processed", "confirmed", "finalized"].includes(String(network.commitment))) {
    errors.push(`${path}.network.commitment: unsupported commitment`);
  }
  text(fixture.protocolRevision ?? fixture.configRevision, `${path}.protocolRevision`, errors);

  if (fixture.oracle !== undefined) {
    if (!isRecord(fixture.oracle)) errors.push(`${path}.oracle: expected object`);
    else validateOracle(fixture.oracle, `${path}.oracle`, errors);
  }
  if (!Array.isArray(fixture.balances)) {
    errors.push(`${path}.balances: expected array`);
  } else {
    fixture.balances.forEach((balance, index) => {
      const balancePath = `${path}.balances[${index}]`;
      if (!isRecord(balance)) {
        errors.push(`${balancePath}: expected object`);
        return;
      }
      text(balance.mint, `${balancePath}.mint`, errors);
      if (typeof balance.decimals !== "number" || !Number.isInteger(balance.decimals) || balance.decimals < 0 || balance.decimals > 255) {
        errors.push(`${balancePath}.decimals: expected u8 JSON number`);
      }
      integerString(balance.rawAmount, `${balancePath}.rawAmount`, errors);
      integerString(balance.contextSlot, `${balancePath}.contextSlot`, errors);
    });
  }
}

function validateObservation(fixture: UnknownRecord, path: string, errors: string[]): void {
  const status = fixture.status;
  if (typeof status !== "string" || !observationStatuses.has(status)) {
    errors.push(`${path}.status: unsupported observation state`);
    return;
  }
  if (status === "available") {
    if (fixture.kind === "observation") {
      validateSnapshot(fixture, path, errors);
      if (!["value", "oracle", "balances", "pool"].some((field) => field in fixture)) {
        errors.push(`${path}: available snapshot needs a value payload`);
      }
    } else if (fixture.kind === "oracle-observation") validateOracle(fixture, path, errors);
    else errors.push(`${path}.kind: unsupported observation kind`);
    return;
  }
  if (text(fixture.reason, `${path}.reason`, errors) && !REASON.test(fixture.reason as string)) {
    errors.push(`${path}.reason: expected stable snake_case reason code`);
  }
  if ("value" in fixture && fixture.value !== null) {
    errors.push(`${path}.value: unavailable observation cannot carry a usable or numeric placeholder`);
  }
  if (fixture.kind === "observation") {
    for (const field of ["oracle", "balances", "pool"]) {
      if (field in fixture) errors.push(`${path}.${field}: failed snapshot cannot carry available payload`);
    }
  }
}

function validateReceipt(fixture: UnknownRecord, path: string, errors: string[]): void {
  const status = fixture.status;
  if (typeof status !== "string" || !receiptStatuses.has(status)) {
    errors.push(`${path}.status: unsupported wallet-action state`);
    return;
  }
  if (status === "draft" || status === "awaiting_signature") {
    if ("confirmationSlot" in fixture) errors.push(`${path}.confirmationSlot: only confirmed receipts carry a confirmation slot`);
    if ("tokenDeltas" in fixture || "shareDelta" in fixture) errors.push(`${path}: unconfirmed receipt cannot assert RPC-derived deltas`);
    return;
  }
  if (status === "confirmed") {
    requiredText(fixture, ["signature", "messageHash", "genesisHash"], path, errors);
    integerString(fixture.confirmationSlot, `${path}.confirmationSlot`, errors);
    if (!Array.isArray(fixture.tokenDeltas) || fixture.tokenDeltas.length === 0) {
      errors.push(`${path}.tokenDeltas: confirmed receipt requires RPC-derived token deltas`);
    } else {
      fixture.tokenDeltas.forEach((delta, index) => {
        const deltaPath = `${path}.tokenDeltas[${index}]`;
        if (!isRecord(delta)) {
          errors.push(`${deltaPath}: expected object`);
          return;
        }
        text(delta.mint, `${deltaPath}.mint`, errors);
        integerString(delta.rawDelta, `${deltaPath}.rawDelta`, errors, true, -U64_MAX, U64_MAX);
      });
    }
    integerString(fixture.shareDelta, `${path}.shareDelta`, errors, true, -U64_MAX, U64_MAX);
    return;
  }
  if ("confirmationSlot" in fixture) errors.push(`${path}.confirmationSlot: only confirmed receipts carry a confirmation slot`);
  if ("tokenDeltas" in fixture || "shareDelta" in fixture) errors.push(`${path}: unconfirmed receipt cannot assert RPC-derived deltas`);
  if (status === "rejected" || status === "unknown") {
    if (text(fixture.reason, `${path}.reason`, errors) && !REASON.test(fixture.reason as string)) {
      errors.push(`${path}.reason: expected stable snake_case reason code`);
    }
  }
  if (status === "unknown" && fixture.automaticResendAllowed !== false) {
    errors.push(`${path}.automaticResendAllowed: unknown actions must not automatically resend`);
  }
}

/** Returns conformance errors without normalizing unknown states or numeric strings. */
export function validateReadModelDocument(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ["$: expected object"];
  if (input.schema !== "etf-read-model-v1") errors.push("$.schema: expected etf-read-model-v1");
  if (input.fixtureOnly !== true) errors.push("$.fixtureOnly: must remain true; this validator is not production policy");
  if (!Array.isArray(input.fixtures) || input.fixtures.length === 0) return [...errors, "$.fixtures: expected non-empty array"];
  const ids = new Set<string>();
  const observationStates = new Set<string>();
  const oracleModes = new Set<string>();
  const receiptStates = new Set<string>();
  let hasAvailableSnapshot = false;
  let hasLargeWireInteger = false;
  let hasMaxU64Amount = false;
  input.fixtures.forEach((fixture, index) => {
    const path = `$.fixtures[${index}]`;
    if (!isRecord(fixture)) {
      errors.push(`${path}: expected object`);
      return;
    }
    if (!text(fixture.id, `${path}.id`, errors)) return;
    if (ids.has(fixture.id)) errors.push(`${path}.id: duplicate fixture id ${fixture.id}`);
    ids.add(fixture.id);
    if (fixture.kind === "wallet-action") {
      validateReceipt(fixture, path, errors);
      if (typeof fixture.status === "string") receiptStates.add(fixture.status);
    }
    else if (fixture.kind === "observation" || fixture.kind === "oracle-observation") {
      validateObservation(fixture, path, errors);
      if (typeof fixture.status === "string") observationStates.add(fixture.status);
      const oracle = isRecord(fixture.oracle) ? fixture.oracle : undefined;
      const mode = fixture.kind === "oracle-observation" ? fixture.mode : oracle?.mode;
      if (typeof mode === "string" && (mode === "receiver_full" || mode === "push_feed")) oracleModes.add(mode);
      if (fixture.kind === "observation" && fixture.status === "available") {
        hasAvailableSnapshot = true;
        if (isRecord(fixture.network) && typeof fixture.network.contextSlot === "string" && /^\d+$/.test(fixture.network.contextSlot)) {
          if (BigInt(fixture.network.contextSlot) > BigInt(Number.MAX_SAFE_INTEGER)) hasLargeWireInteger = true;
        }
        if (Array.isArray(fixture.balances) && fixture.balances.some((balance) =>
          isRecord(balance) && balance.rawAmount === U64_MAX.toString()
        )) hasMaxU64Amount = true;
      }
    }
    else errors.push(`${path}.kind: unsupported fixture kind`);
  });

  for (const required of ["stale", "unavailable"]) {
    if (!observationStates.has(required)) errors.push(`$.fixtures: missing ${required} observation example`);
  }
  if (!hasAvailableSnapshot) errors.push("$.fixtures: missing available snapshot with network identity");
  for (const required of ["receiver_full", "push_feed"]) {
    if (!oracleModes.has(required)) errors.push(`$.fixtures: missing ${required} oracle-mode example`);
  }
  for (const required of ["confirmed", "unknown"]) {
    if (!receiptStates.has(required)) errors.push(`$.fixtures: missing ${required} wallet-action example`);
  }
  if (!hasLargeWireInteger || !hasMaxU64Amount) {
    errors.push("$.fixtures: missing integer-precision boundaries (>2^53 slot and max-u64 token amount)");
  }
  return errors;
}

export function parseReadModelDocument(input: unknown): EtfReadModelFixtureDocument {
  const errors = validateReadModelDocument(input);
  if (errors.length > 0) throw new Error(`Invalid ETF read-model fixture:\n${errors.join("\n")}`);
  return input as EtfReadModelFixtureDocument;
}
