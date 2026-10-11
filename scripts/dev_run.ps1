#requires -version 5.1
<#
.SYNOPSIS
Runs coloyond-etf against a local `solana-test-validator` end-to-end.

.DESCRIPTION
The script does four things and prints its progress at every step:

  1. Kills any pre-existing test-validator (its PID file is at $env:TEMP\coloyond-etf-validator.pid)
  2. Starts `solana-test-validator --funding <devnet-keypair>` in the background
     and waits for `getHealth` to answer
  3. Builds the ETF program to SBF and deploys it, setting the deploy address
     into the workspace's Anchor.toml `toolchain.solan_version` (unchanged) and
     into `packages/etf-client/src/devnet-read.ts` at runtime via env
  4. Terminates the validator

.PARAMETER SkipTests
Skip the on-host cargo test before the deploy (fast loop).

.PARAMETER SkipDeploy
Only start the validator and print its URL, without building or deploying.
#>

[CmdletBinding()]
Param(
    [Switch]$SkipTests,
    [Switch]$SkipDeploy,
    [Long]$FaucetLamports = 100000000000000,
    [String]$ProgramId = "H3CkHowYVQcxrKXWkyswMW2rqRNzRQYaQr7N8LKXFUt9"
)

Set-StrictMode -Version 2.0

$Repo = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $env:TEMP "coloyond-etf-validator.pid"
$Log = Join-Path $env:TEMP "coloyond-etf-validator.log"
$Rpc = "http://127.0.0.1:8899"

function Stop-ExistingValidator {
    if (Test-Path -LiteralPath $PidFile) {
        $validatorPid = (Get-Content -LiteralPath $PidFile | Select-Object -First 1)
        try {
            Stop-Process -Id ([Int]$validatorPid) -Force -ErrorAction Stop
            Write-Host "killed pre-existing validator pid $validatorPid"
        } catch {
            Write-Host "no live validator with pid $validatorPid (already gone)"
        }
    }
}

function Start-TestValidator {
    $validator = (Get-Command solana-test-validator -ErrorAction SilentlyContinue).Source
    if (-not $validator) { throw "solana-test-validator is not on PATH. Install Agave first (see docs/HANDOFF.md)." }
    $proc = Start-Process -FilePath $validator -ArgumentList @(
        "--funding", "$Repo\devnet-program-keypair.json",
        "--faucet-lamports", "$FaucetLamports",
        "--commitment-level", "Finalized",
        "--log", $Log
    ) -PassThru
    Set-Content -LiteralPath $PidFile -Value $proc.Id
    Write-Host "started validator pid $($proc.Id), log at $Log"
}

function Wait-RpcHealthy {
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $health = Invoke-RestMethod -Uri $Rpc -Method Post -Body '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' -ContentType "application/json" -TimeoutSec 3
            if ($health.Content -match '"result":"ok"') { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "validator RPC at $Rpc did not report healthy within 30s"
}

Stop-ExistingValidator
Start-TestValidator
Wait-RpcHealthy
Write-Host "RPC is healthy at $Rpc"

if (-not $SkipTests) {
    Write-Host "== cargo test (etf workspace) =="
    Push-Location "$Repo\programs\coloyond-etf"
    try { cargo test 2>&1 | Select-Object -Last 3 } finally { Pop-Location }
    if ($LastExitCode -ne 0) { throw "cargo test failed" }
}

if (-not $SkipDeploy) {
    Write-Host "== cargo build-sbf + solana program deploy =="
    Push-Location "$Repo\programs\coloyond-etf"
    try {
        cargo build-sbf 2>&1 | Select-Object -Last 3
        if ($LastExitCode -ne 0) { throw "cargo build-sbf failed" }
        $so = Join-Path "target\deploy\coloyond_etf.so"
        if (-not (Test-Path -LiteralPath $so)) { throw "expected built program at $so" }
        solana -u $Rpc program deploy $ProgramId $so
        solana -u $Rpc program show $ProgramId
    } finally { Pop-Location }
}

Write-Host "== leaving validator running; to stop: Stop-Process -Id (Get-Content $PidFile) =="
