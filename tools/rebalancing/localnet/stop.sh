#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../../.." && pwd)"
solana_bin_dir="${SOLANA_BIN_DIR:-$HOME/.local/share/solana/install/active_release/bin}"
if [[ -d "$solana_bin_dir" ]]; then
  export PATH="$solana_bin_dir:$HOME/.cargo/bin:$PATH"
fi
runtime_dir="${COLOYOND_LOCALNET_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/coloyond/localnet}"
pid_file="$runtime_dir/validator.pid"

if [[ -f "$pid_file" ]]; then
  validator_pid="$(cat "$pid_file")"
  validator_command="$(ps -p "$validator_pid" -o command= 2>/dev/null || true)"
  if [[ "$validator_command" == *solana-test-validator* ]]; then
    kill "$validator_pid"
    for _ in $(seq 1 30); do
      kill -0 "$validator_pid" 2>/dev/null || break
      sleep 1
    done
  fi
  rm -f "$pid_file"
fi
rm -f "$repo_root/public/localnet-manifest.json"
echo "Localnet stopped; runtime ledger and wallet remain under $runtime_dir."
