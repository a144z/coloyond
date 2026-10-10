#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runtime_dir="${COLOYOND_LOCALNET_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/coloyond/localnet}"

"$script_dir/stop.sh"
rm -rf "$runtime_dir/ledger" "$runtime_dir/fixtures"
echo "Localnet ledger reset. Recreate the deterministic fixture state with start.sh."
