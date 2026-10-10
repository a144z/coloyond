#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runtime_dir="${COLOYOND_LOCALNET_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/coloyond/localnet}"
wallet_path="${COLOYOND_LOCALNET_WALLET:-$runtime_dir/wallet.json}"

if [[ ! -f "$wallet_path" ]]; then
  echo "No Localnet wallet found at $wallet_path. Run start.sh first." >&2
  exit 1
fi
if ! command -v pbcopy >/dev/null 2>&1; then
  echo "This helper requires macOS pbcopy; it will not print the secret to the terminal." >&2
  exit 1
fi

node - "$wallet_path" <<'JS' | pbcopy
import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!Array.isArray(raw) || raw.length !== 64) throw new Error('Unexpected Solana keypair file');
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const bytes = Buffer.from(raw);
let zeros = 0;
while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
let value = BigInt(`0x${bytes.toString('hex')}`);
let encoded = '';
while (value > 0n) {
  const remainder = Number(value % 58n);
  value /= 58n;
  encoded = alphabet[remainder] + encoded;
}
process.stdout.write('1'.repeat(zeros) + encoded);
JS
echo "Localnet private key copied to the clipboard. It was not printed. Paste it only into your wallet's Solana private-key import screen."
