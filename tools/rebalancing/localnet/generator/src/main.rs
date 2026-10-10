use std::{
    env,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use anchor_lang::{
    prelude::{AccountSerialize, Pubkey},
    solana_program::program_option::COption,
};
use anchor_spl::token::ID as TOKEN_PROGRAM_ID;
use coloyond_vault::{
    auction::{AuctionPolicy, AUCTION_POLICY_VERSION},
    instructions::{GovernanceAccount, ASSOCIATED_TOKEN_PROGRAM_ID, GOVERNANCE_SEED, VAULT_SEED},
    oracle::{
        PYTH_RECEIVER_PROGRAM_ID, SOL_USD_FEED_ACCOUNT, SOL_USD_FEED_ID, USDC_USD_FEED_ACCOUNT,
        USDC_USD_FEED_ID,
    },
    state::{AssetConfig, Vault, ASSET_COUNT, VAULT_VERSION},
    ID as VAULT_PROGRAM_ID,
};
use pyth_solana_receiver_sdk::price_update::{
    get_feed_id_from_hex, PriceFeedMessage, PriceUpdateV2, VerificationLevel,
};
use serde::Serialize;
use solana_program_pack::Pack;
use spl_token::state::{Account as SplAccount, AccountState, Mint as SplMint};

const LOCALNET_RPC: &str = "http://127.0.0.1:8899";
const LOCALNET_WS: &str = "ws://127.0.0.1:8900";
const USDC_DECIMALS: u8 = 6;
const WSOL_DECIMALS: u8 = 9;
const USDC_PRICE: i64 = 1;
const SOL_PRICE: i64 = 100;
const USD_EXPONENT: i32 = 0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalnetManifest {
    schema_version: u8,
    cluster: &'static str,
    rpc_url: &'static str,
    ws_url: &'static str,
    expected_genesis_hash: &'static str,
    program_id: String,
    vault: String,
    governance: String,
    auction_policy: String,
    intent: String,
    sol_usd: String,
    usdc_usd: String,
    wsol_mint: String,
    usdc_mint: String,
    share_mint: String,
    custody_wsol: String,
    custody_usdc: String,
    taker_wallet: String,
    caller: String,
    executor: String,
    taker: String,
    taker_wsol: String,
    taker_usdc: String,
    bounty_claim: String,
    next_bounty_claim: String,
    wrong_sol_usd_feed: String,
    token_program_id: String,
    associated_token_program_id: String,
    system_program_id: String,
    fixture_kind: &'static str,
    fixture_notice: &'static str,
    auction_duration_slots: String,
    start_sell_asset: u8,
    start_amount: String,
    fill_sequence: String,
    fill_sell_amount: String,
    fill_gross_buy_amount: String,
    fill_bounty_amount: String,
    next_fill_sequence: String,
    next_fill_sell_amount: String,
    next_fill_gross_buy_amount: String,
    next_fill_bounty_amount: String,
    replay_sequence: String,
    adverse_fill_sell_amount: String,
    adverse_fill_gross_buy_amount: String,
    oversize_fill_sell_amount: String,
    oversize_fill_gross_buy_amount: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidatorAccount {
    pubkey: String,
    account: AccountDump,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountDump {
    lamports: u64,
    data: [String; 2],
    owner: String,
    executable: bool,
    rent_epoch: u64,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("localnet fixture generation failed: {error}");
        process::exit(1);
    }
}

fn run() -> std::result::Result<(), String> {
    let mut args = env::args().skip(1);
    let mut output_dir = None;
    let mut wallet = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--output-dir" => output_dir = args.next().map(PathBuf::from),
            "--wallet-address" => wallet = args.next(),
            _ => return Err(format!("unknown argument: {arg}")),
        }
    }
    let output_dir = output_dir.ok_or("missing --output-dir")?;
    let wallet = wallet
        .ok_or("missing --wallet-address")?
        .parse::<Pubkey>()
        .map_err(|error| format!("invalid wallet address: {error}"))?;
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let (vault_key, vault_bump) = Pubkey::find_program_address(&[VAULT_SEED], &VAULT_PROGRAM_ID);
    let (governance_key, _) =
        Pubkey::find_program_address(&[GOVERNANCE_SEED, vault_key.as_ref()], &VAULT_PROGRAM_ID);
    let (policy_key, _) =
        Pubkey::find_program_address(&[b"auction_policy", vault_key.as_ref()], &VAULT_PROGRAM_ID);
    let (intent_key, _) = Pubkey::find_program_address(
        &[b"rebalance_intent", vault_key.as_ref()],
        &VAULT_PROGRAM_ID,
    );
    let wsol_mint = Pubkey::find_program_address(&[b"localnet-wsol-mint"], &VAULT_PROGRAM_ID).0;
    let usdc_mint = Pubkey::find_program_address(&[b"localnet-usdc-mint"], &VAULT_PROGRAM_ID).0;
    let share_mint = Pubkey::find_program_address(
        &[b"localnet-share-mint", vault_key.as_ref()],
        &VAULT_PROGRAM_ID,
    )
    .0;
    let custody_wsol = associated_token_address(vault_key, wsol_mint);
    let custody_usdc = associated_token_address(vault_key, usdc_mint);
    let taker_wsol = associated_token_address(wallet, wsol_mint);
    let taker_usdc = associated_token_address(wallet, usdc_mint);
    let bounty_claim = Pubkey::find_program_address(
        &[b"bounty_claim", vault_key.as_ref(), &1u64.to_le_bytes()],
        &VAULT_PROGRAM_ID,
    )
    .0;
    let next_bounty_claim = Pubkey::find_program_address(
        &[b"bounty_claim", vault_key.as_ref(), &2u64.to_le_bytes()],
        &VAULT_PROGRAM_ID,
    )
    .0;

    let assets = [
        AssetConfig {
            mint: wsol_mint,
            token_program: TOKEN_PROGRAM_ID,
            custody: custody_wsol,
            decimals: WSOL_DECIMALS,
            target_bps: 5_000,
        },
        AssetConfig {
            mint: usdc_mint,
            token_program: TOKEN_PROGRAM_ID,
            custody: custody_usdc,
            decimals: USDC_DECIMALS,
            target_bps: 5_000,
        },
    ];
    let vault = Vault {
        version: VAULT_VERSION,
        bump: vault_bump,
        status: 1,
        authority: vault_key,
        configuration_revision: 1,
        assets,
        share_mint,
        total_shares: 1_500_000_000,
        minimum_locked_shares: 1_000_000,
        accounted_amounts: [20_000_000_000, 500_000_000],
        bootstrap_reserve: [0, 5_000_000],
        bounty_liabilities: [0, 0],
        sequence: 0,
    };
    let governance = GovernanceAccount {
        version: 1,
        vault: vault_key,
        share_mint,
        allowed_mints: [wsol_mint, usdc_mint],
        governance_authority: wallet,
        emergency_authority: Pubkey::find_program_address(
            &[b"localnet-emergency-authority"],
            &VAULT_PROGRAM_ID,
        )
        .0,
        min_delay_slots: 1,
        configuration_revision: 1,
        target_bps: [5_000; ASSET_COUNT],
        proposal_nonce: 0,
        pending: None,
        risk_paused: false,
    };
    let duration_slots = env::var("COLOYOND_LOCALNET_DURATION_SLOTS")
        .ok()
        .map(|value| value.parse::<u64>().map_err(|error| error.to_string()))
        .transpose()?
        .unwrap_or(100);
    if duration_slots == 0 {
        return Err("COLOYOND_LOCALNET_DURATION_SLOTS must be positive".into());
    }
    let policy = AuctionPolicy {
        version: AUCTION_POLICY_VERSION,
        vault: vault_key,
        configuration_revision: 1,
        maximum_age_seconds: 3_600,
        maximum_confidence_bps: 100,
        maximum_usdc_deviation_bps: 100,
        minimum_drift_bps: 500,
        maximum_trade_value_q9: 500_000_000_000,
        cooldown_slots: 1,
        last_completed_slot: None,
        curve_start_rate_bps: 10_100,
        curve_end_rate_bps: 10_000,
        duration_slots,
        fee_bps: 20,
        maximum_fee_bps: 50,
        maximum_bounty_per_fill: 1_000_000,
        maximum_cumulative_nav_loss_bps: 100,
        maximum_nav_loss_bps: 25,
        asset_feed_indices: [0, 1],
    };

    write_anchor_account(&output_dir, vault_key, VAULT_PROGRAM_ID, &vault, "vault")?;
    write_anchor_account(
        &output_dir,
        governance_key,
        VAULT_PROGRAM_ID,
        &governance,
        "governance",
    )?;
    write_anchor_account(
        &output_dir,
        policy_key,
        VAULT_PROGRAM_ID,
        &policy,
        "auction-policy",
    )?;

    write_account(
        &output_dir,
        wsol_mint,
        TOKEN_PROGRAM_ID,
        pack_mint(WSOL_DECIMALS, 20_000_000_000, Some(vault_key)),
        "wsol-mint",
    )?;
    write_account(
        &output_dir,
        usdc_mint,
        TOKEN_PROGRAM_ID,
        pack_mint(USDC_DECIMALS, 750_000_000, Some(vault_key)),
        "usdc-mint",
    )?;
    write_account(
        &output_dir,
        share_mint,
        TOKEN_PROGRAM_ID,
        pack_mint(6, 1_500_000_000, Some(vault_key)),
        "share-mint",
    )?;
    for (name, key, mint, owner, amount) in [
        (
            "custody-wsol",
            custody_wsol,
            wsol_mint,
            vault_key,
            20_000_000_000,
        ),
        (
            "custody-usdc",
            custody_usdc,
            usdc_mint,
            vault_key,
            500_000_000,
        ),
        ("taker-wsol", taker_wsol, wsol_mint, wallet, 0),
        ("taker-usdc", taker_usdc, usdc_mint, wallet, 250_000_000),
    ] {
        write_account(
            &output_dir,
            key,
            TOKEN_PROGRAM_ID,
            pack_token_account(mint, owner, amount),
            name,
        )?;
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs() as i64;
    let sol = make_price_update(SOL_USD_FEED_ID, SOL_PRICE, now)?;
    let usdc = make_price_update(USDC_USD_FEED_ID, USDC_PRICE, now)?;
    write_anchor_account(
        &output_dir,
        SOL_USD_FEED_ACCOUNT,
        PYTH_RECEIVER_PROGRAM_ID,
        &sol,
        "sol-usd",
    )?;
    write_anchor_account(
        &output_dir,
        USDC_USD_FEED_ACCOUNT,
        PYTH_RECEIVER_PROGRAM_ID,
        &usdc,
        "usdc-usd",
    )?;

    let manifest = LocalnetManifest {
        schema_version: 1,
        cluster: "localnet",
        rpc_url: LOCALNET_RPC,
        ws_url: LOCALNET_WS,
        expected_genesis_hash: "pending-validator-startup",
        program_id: VAULT_PROGRAM_ID.to_string(),
        vault: vault_key.to_string(),
        governance: governance_key.to_string(),
        auction_policy: policy_key.to_string(),
        intent: intent_key.to_string(),
        sol_usd: SOL_USD_FEED_ACCOUNT.to_string(),
        usdc_usd: USDC_USD_FEED_ACCOUNT.to_string(),
        wsol_mint: wsol_mint.to_string(),
        usdc_mint: usdc_mint.to_string(),
        share_mint: share_mint.to_string(),
        custody_wsol: custody_wsol.to_string(),
        custody_usdc: custody_usdc.to_string(),
        taker_wallet: wallet.to_string(),
        caller: wallet.to_string(),
        executor: wallet.to_string(),
        taker: wallet.to_string(),
        taker_wsol: taker_wsol.to_string(),
        taker_usdc: taker_usdc.to_string(),
        bounty_claim: bounty_claim.to_string(),
        next_bounty_claim: next_bounty_claim.to_string(),
        wrong_sol_usd_feed: USDC_USD_FEED_ACCOUNT.to_string(),
        token_program_id: TOKEN_PROGRAM_ID.to_string(),
        associated_token_program_id: ASSOCIATED_TOKEN_PROGRAM_ID.to_string(),
        system_program_id: anchor_lang::system_program::ID.to_string(),
        fixture_kind: "localnet-oracle-fixture",
        fixture_notice: "The wSOL and USDC mints are Localnet-only test tokens. SOL/USD ($100) and USDC/USD ($1) are synthetic Localnet fixture values loaded into the fixed Pyth account addresses; they are not Pyth-authenticated market data. The vault auction and SPL Token transfers execute against the compiled SBF program on the local Solana validator.",
        auction_duration_slots: duration_slots.to_string(),
        start_sell_asset: 0,
        start_amount: "1000000000".into(),
        fill_sequence: "1".into(),
        fill_sell_amount: "500000000".into(),
        fill_gross_buy_amount: "51000000".into(),
        fill_bounty_amount: "10000".into(),
        next_fill_sequence: "2".into(),
        next_fill_sell_amount: "500000000".into(),
        next_fill_gross_buy_amount: "51000000".into(),
        next_fill_bounty_amount: "10000".into(),
        replay_sequence: "1".into(),
        adverse_fill_sell_amount: "500000000".into(),
        adverse_fill_gross_buy_amount: "50000000".into(),
        oversize_fill_sell_amount: "1000000001".into(),
        oversize_fill_gross_buy_amount: "102000000".into(),
    };
    write_json(&output_dir.join("manifest.json"), &manifest)?;
    println!("Localnet fixtures generated in {}", output_dir.display());
    println!("Wallet public key: {wallet}");
    println!("Oracle accounts contain Localnet fixture values, not authenticated Pyth updates.");
    Ok(())
}

fn associated_token_address(owner: Pubkey, mint: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

fn pack_mint(decimals: u8, supply: u64, authority: Option<Pubkey>) -> Vec<u8> {
    let mint = SplMint {
        mint_authority: authority.map_or(COption::None, COption::Some),
        supply,
        decimals,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut data = vec![0; SplMint::LEN];
    SplMint::pack(mint, &mut data).expect("valid SPL Mint encoding");
    data
}

fn pack_token_account(mint: Pubkey, owner: Pubkey, amount: u64) -> Vec<u8> {
    let account = SplAccount {
        mint,
        owner,
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    };
    let mut data = vec![0; SplAccount::LEN];
    SplAccount::pack(account, &mut data).expect("valid SPL Token account encoding");
    data
}

fn make_price_update(
    feed_id: &str,
    price: i64,
    publish_time: i64,
) -> std::result::Result<PriceUpdateV2, String> {
    let feed_id =
        get_feed_id_from_hex(feed_id).map_err(|error| format!("bad feed id: {error:?}"))?;
    Ok(PriceUpdateV2 {
        write_authority: Pubkey::new_unique(),
        verification_level: VerificationLevel::Full,
        price_message: PriceFeedMessage {
            feed_id,
            price,
            conf: 0,
            exponent: USD_EXPONENT,
            publish_time,
            prev_publish_time: publish_time.saturating_sub(1),
            ema_price: price,
            ema_conf: 0,
        },
        posted_slot: 0,
    })
}

fn write_anchor_account<T: AccountSerialize>(
    output_dir: &Path,
    key: Pubkey,
    owner: Pubkey,
    account: &T,
    name: &str,
) -> std::result::Result<(), String> {
    let mut data = Vec::new();
    account
        .try_serialize(&mut data)
        .map_err(|error| format!("serialize {name}: {error}"))?;
    write_account(output_dir, key, owner, data, name)
}

fn write_account(
    output_dir: &Path,
    key: Pubkey,
    owner: Pubkey,
    data: Vec<u8>,
    name: &str,
) -> std::result::Result<(), String> {
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data);
    let dump = ValidatorAccount {
        pubkey: key.to_string(),
        account: AccountDump {
            lamports: 10_000_000_000,
            data: [encoded, "base64".into()],
            owner: owner.to_string(),
            executable: false,
            rent_epoch: 0,
        },
    };
    write_json(&output_dir.join(format!("{name}.json")), &dump)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> std::result::Result<(), String> {
    let mut file = File::create(path).map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(&mut file, value).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}
