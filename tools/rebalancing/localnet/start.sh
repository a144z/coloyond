#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"

solana_bin_dir="${SOLANA_BIN_DIR:-$HOME/.local/share/solana/install/active_release/bin}"
if [[ -d "$solana_bin_dir" ]]; then
  export PATH="$solana_bin_dir:$HOME/.cargo/bin:$PATH"
fi

runtime_dir="${COLOYOND_LOCALNET_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/coloyond/localnet}"
wallet_path="${COLOYOND_LOCALNET_WALLET:-$runtime_dir/wallet.json}"
emergency_key_path="${COLOYOND_LOCALNET_EMERGENCY_KEYPAIR:-$runtime_dir/emergency-authority.json}"
ledger_dir="$runtime_dir/ledger"
fixture_dir="$runtime_dir/fixtures"
pid_file="$runtime_dir/validator.pid"
log_file="$runtime_dir/validator.log"
rpc_port="${COLOYOND_LOCALNET_RPC_PORT:-8899}"
faucet_port="${COLOYOND_LOCALNET_FAUCET_PORT:-9900}"
gossip_port="${COLOYOND_LOCALNET_GOSSIP_PORT:-8001}"
dynamic_port_range="${COLOYOND_LOCALNET_DYNAMIC_PORT_RANGE:-1024-65535}"
rpc_url="http://127.0.0.1:$rpc_port"
ws_url="ws://127.0.0.1:$((rpc_port + 1))"
program_id="FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6"
program_so="$repo_root/target/deploy/coloyond_vault.so"
tools_version="${COLOYOND_SBF_TOOLS_VERSION:-v1.57}"
sbf_rustc="${SOLANA_SBF_RUSTC:-$HOME/.cache/solana/$tools_version/platform-tools/rust/bin/rustc}"
generator_manifest="$script_dir/generator/Cargo.toml"
public_manifest="$repo_root/public/localnet-manifest.json"

mkdir -p "$runtime_dir" "$fixture_dir"
chmod 700 "$runtime_dir"
mkdir -p "$(dirname "$wallet_path")"
mkdir -p "$(dirname "$emergency_key_path")"

if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "Localnet validator is already running (pid $(cat "$pid_file")). Use stop.sh first."
  exit 1
fi
if solana cluster-version --url "$rpc_url" >/dev/null 2>&1; then
  echo "An RPC service is already responding at $rpc_url. Stop it before starting this fixture validator."
  exit 1
fi

if [[ ! -f "$wallet_path" ]]; then
  umask 077
  solana-keygen new --no-bip39-passphrase --silent --outfile "$wallet_path" >"$runtime_dir/keygen.log" 2>&1
  chmod 600 "$wallet_path"
  echo "Created a throwaway Localnet wallet at $wallet_path (secret suppressed)."
fi
chmod 600 "$wallet_path"
wallet_pubkey="$(solana address --keypair "$wallet_path")"
if [[ ! -f "$emergency_key_path" ]]; then
  umask 077
  solana-keygen new --no-bip39-passphrase --silent --outfile "$emergency_key_path" >"$runtime_dir/emergency-keygen.log" 2>&1
  chmod 600 "$emergency_key_path"
  echo "Created a throwaway Localnet emergency authority at $emergency_key_path (secret suppressed)."
fi
chmod 600 "$emergency_key_path"
emergency_pubkey="$(solana address --keypair "$emergency_key_path")"

echo "Building Localnet fixture accounts..."
cargo run --offline --quiet --manifest-path "$generator_manifest" -- \
  --output-dir "$fixture_dir" \
  --wallet-address "$wallet_pubkey" \
  --emergency-authority "$emergency_pubkey" \
  --rpc-url "$rpc_url" \
  --ws-url "$ws_url" \
  --minimum-delay-slots "${COLOYOND_LOCALNET_MIN_DELAY_SLOTS:-1}"

account_pubkey() {
  python3 - "$fixture_dir/$1.json" <<'PY'
import json
import pathlib
import sys

print(json.loads(pathlib.Path(sys.argv[1]).read_text())["pubkey"])
PY
}

echo "Building the vault SBF program..."
if [[ ! -x "$sbf_rustc" ]]; then
  echo "Missing Solana SBF rustc at $sbf_rustc. Set SOLANA_SBF_RUSTC or install platform tools $tools_version." >&2
  exit 1
fi
RUSTC="$sbf_rustc" cargo-build-sbf --no-rustup-override --tools-version "$tools_version" \
  --manifest-path "$repo_root/programs/coloyond-vault/Cargo.toml" \
  --sbf-out-dir "$repo_root/target/deploy" -- --offline
if [[ ! -s "$program_so" ]]; then
  echo "SBF build did not produce $program_so" >&2
  exit 1
fi

mkdir -p "$ledger_dir"
solana-test-validator --reset --ledger "$ledger_dir" \
  --bind-address 127.0.0.1 \
  --rpc-port "$rpc_port" \
  --faucet-port "$faucet_port" \
  --gossip-port "$gossip_port" \
  --dynamic-port-range "$dynamic_port_range" \
  --bpf-program "$program_id" "$program_so" \
  --account "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE" "$fixture_dir/sol-usd.json" \
  --account "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX" "$fixture_dir/usdc-usd.json" \
  --account "$(account_pubkey vault)" "$fixture_dir/vault.json" \
  --account "$(account_pubkey governance)" "$fixture_dir/governance.json" \
  --account "$(account_pubkey auction-policy)" "$fixture_dir/auction-policy.json" \
  --account "$(account_pubkey wsol-mint)" "$fixture_dir/wsol-mint.json" \
  --account "$(account_pubkey usdc-mint)" "$fixture_dir/usdc-mint.json" \
  --account "$(account_pubkey share-mint)" "$fixture_dir/share-mint.json" \
  --account "$(account_pubkey custody-wsol)" "$fixture_dir/custody-wsol.json" \
  --account "$(account_pubkey custody-usdc)" "$fixture_dir/custody-usdc.json" \
  --account "$(account_pubkey taker-wsol)" "$fixture_dir/taker-wsol.json" \
  --account "$(account_pubkey taker-usdc)" "$fixture_dir/taker-usdc.json" \
  >"$log_file" 2>&1 &
validator_pid=$!
printf '%s\n' "$validator_pid" >"$pid_file"
startup_complete=false
cleanup_failed_start() {
  if [[ "$startup_complete" != true ]]; then
    kill "$validator_pid" 2>/dev/null || true
    rm -f "$pid_file"
  fi
}
trap cleanup_failed_start EXIT

ready=false
for _ in $(seq 1 90); do
  if ! kill -0 "$validator_pid" 2>/dev/null; then
    echo "Localnet validator exited during startup. Recent log:" >&2
    tail -80 "$log_file" >&2 || true
    rm -f "$pid_file"
    exit 1
  fi
  if solana cluster-version --url "$rpc_url" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Localnet validator did not become ready. Recent log:" >&2
  tail -80 "$log_file" >&2 || true
  kill "$validator_pid" 2>/dev/null || true
  rm -f "$pid_file"
  exit 1
fi

echo "Funding Localnet test wallet..."
solana airdrop 20 "$wallet_pubkey" --keypair "$wallet_path" --url "$rpc_url"
genesis_hash="$(solana genesis-hash --url "$rpc_url")"
python3 - "$fixture_dir/manifest.json" "$public_manifest" "$genesis_hash" <<'PY'
import json
import pathlib
import sys

template_path, output_path, genesis_hash = sys.argv[1:]
manifest = json.loads(pathlib.Path(template_path).read_text())
manifest["expectedGenesisHash"] = genesis_hash.strip()
target = pathlib.Path(output_path)
target.write_text(json.dumps(manifest, indent=2) + "\n")
PY

echo "Localnet is ready at $rpc_url (genesis $genesis_hash)."
echo "Wallet public key: $wallet_pubkey"
echo "Public UI manifest: $public_manifest"
echo "Validator log: $log_file"
echo "Stop with: $script_dir/stop.sh"
startup_complete=true
