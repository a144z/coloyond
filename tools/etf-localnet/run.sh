#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
solana_bin_dir="${SOLANA_BIN_DIR:-$HOME/.local/share/solana/install/releases/2.3.0/solana-release/bin}"
tools_version="${COLOYOND_ETF_SBF_TOOLS_VERSION:-v1.57}"
sbf_rustc="${SOLANA_SBF_RUSTC:-$HOME/.cache/solana/$tools_version/platform-tools/rust/bin/rustc}"
rpc_port="${COLOYOND_ETF_LOCALNET_RPC_PORT:-18899}"
faucet_port="${COLOYOND_ETF_LOCALNET_FAUCET_PORT:-19899}"
gossip_port="${COLOYOND_ETF_LOCALNET_GOSSIP_PORT:-18001}"
dynamic_ports="${COLOYOND_ETF_LOCALNET_DYNAMIC_PORT_RANGE:-18002-18022}"
rpc_url="http://127.0.0.1:$rpc_port"
program_id="H3CkHowYVQcxrKXWkyswMW2rqRNzRQYaQr7N8LKXFUt9"
program_so="$repo_root/target/deploy/coloyond_etf.so"
runtime_dir="${COLOYOND_ETF_LOCALNET_HOME:-${TMPDIR:-/tmp}/coloyond-etf-localnet}"
ledger_dir="$runtime_dir/ledger"
log_file="$runtime_dir/validator.log"

for tool in cargo-build-sbf solana-test-validator; do
  if [[ ! -x "$solana_bin_dir/$tool" ]]; then
    echo "Missing $tool under $solana_bin_dir. Set SOLANA_BIN_DIR; this harness never installs tools." >&2
    exit 1
  fi
done
if [[ ! -x "$sbf_rustc" ]]; then
  echo "Missing cached SBF rustc at $sbf_rustc. Set SOLANA_SBF_RUSTC; this harness never installs tools." >&2
  exit 1
fi

export PATH="$solana_bin_dir:$(dirname "$sbf_rustc"):$PATH"
mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"
if solana cluster-version --url "$rpc_url" >/dev/null 2>&1; then
  echo "Refusing to replace the RPC service already listening at $rpc_url. Stop it or select a different COLOYOND_ETF_LOCALNET_RPC_PORT." >&2
  exit 1
fi

echo "Building the ETF SBF program offline with cached platform tools $tools_version..."
RUSTC="$sbf_rustc" cargo-build-sbf \
  --manifest-path "$repo_root/programs/coloyond-etf/Cargo.toml" \
  --tools-version "$tools_version" \
  --skip-tools-install \
  --no-rustup-override \
  --sbf-out-dir "$repo_root/target/deploy" \
  -- --offline
if [[ ! -s "$program_so" ]]; then
  echo "SBF build did not produce $program_so" >&2
  exit 1
fi

echo "Starting isolated Localnet at $rpc_url (no Devnet/Mainnet RPC is used)..."
solana-test-validator --reset --ledger "$ledger_dir" \
  --bind-address 127.0.0.1 \
  --rpc-port "$rpc_port" \
  --faucet-port "$faucet_port" \
  --gossip-port "$gossip_port" \
  --dynamic-port-range "$dynamic_ports" \
  --bpf-program "$program_id" "$program_so" \
  >"$log_file" 2>&1 &
validator_pid=$!
cleanup() {
  kill "$validator_pid" 2>/dev/null || true
  wait "$validator_pid" 2>/dev/null || true
  echo "Stopped Localnet validator. Log retained at $log_file."
}
trap cleanup EXIT INT TERM

ready=false
for _ in $(seq 1 60); do
  if ! kill -0 "$validator_pid" 2>/dev/null; then
    echo "Localnet validator exited during startup. Recent log:" >&2
    tail -60 "$log_file" >&2 || true
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
  tail -60 "$log_file" >&2 || true
  exit 1
fi

export COLOYOND_ETF_LOCALNET_RPC_URL="$rpc_url"
export COLOYOND_ETF_LOCALNET_PROGRAM_ID="$program_id"
export NODE_PATH="${NODE_PATH:-$repo_root/node_modules}"
node "$repo_root/tools/etf-localnet/run.cjs"
