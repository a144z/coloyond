/**
 * Cluster + product constants.
 * Everything here targets the standard-SPL devnet vault and its program-owned
 * synthetic market accounts.
 */

export const CLUSTER = 'devnet' as const;
export const RPC_URL = 'https://api.devnet.solana.com';
/** MagicBlock's public Devnet Ephemeral Rollup endpoint. */
export const ER_RPC_URL = 'https://devnet.magicblock.app/';
export const ROUTER_RPC_URL = 'https://devnet-router.magicblock.app/';
export const EXECUTION_PROGRAM_ID = 'HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d';

/** Reserve economics, from the design sheet: spread and curve-fee margin. */
export const RESERVE_SPREAD_PCT = 0.3;
export const CURVE_BASE_PCT = 0.3;
/** Trade value (as a fraction of reserve depth) at which the curve fee equals the base. */
export const CURVE_DEPTH_FRACTION = 0.1;
export const CURVE_CAP_PCT = 3.0;

/** Automation defaults. */
export const DEFAULT_THRESHOLD_PCT = 2.0;
/** 5,700 Hydra slots targets about one minute on the current Devnet ER. */
export const REBALANCE_INTERVAL_SEC = 60;
export const CADENCE_OPTIONS_SEC = [REBALANCE_INTERVAL_SEC, 120, 300, 600, 1_800, 3_600] as const;
export const BUDGET_FLOOR_LAMPORTS = 2_000_000; // below this, automation halts (blocked: budget)
export const MIN_TX_LAMPORTS = 5_000;
/** Upper bound on trades executed within a single rebalance check. */
export const MAX_TRADES_PER_CHECK = 6;

/** Price observation freshness (the "configured limit" in the blocked state). */
export const PRICE_MAX_AGE_MS = 90_000;
export const PRICE_POLL_MS = 20_000;

/** Coinbase universe refresh: the listed-asset registry re-syncs on this cadence. */
export const UNIVERSE_POLL_MS = 600_000;

/** Polling. */
export const BALANCE_POLL_MS = 10_000;
export const RESERVE_POLL_MS = 60_000;
export const RPC_POLL_MS = 30_000;

/** Devnet faucet. */
export const FAUCET_LAMPORTS = 1_000_000_000;
