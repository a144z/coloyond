#!/usr/bin/env node
/** Install (but do not start) a per-user macOS LaunchAgent for official Hydra cranker processes. */
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const label = 'com.coloyond.vault-cranker';
const home = os.homedir();
const configPath = process.env.COLONYOND_HYDRA_CRANKER_CONFIG;
const plistPath = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
const logDir = path.join(home, 'Library', 'Logs', 'Coloyond');
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerPath = path.join(projectDir, 'scripts', 'run-hydra-cranker-fleet.mjs');

if (process.argv.includes('--self-check')) {
  const xml = renderPlist({ nodePath: '/usr/local/bin/node', runnerPath: '/tmp/runner.mjs', projectDir: '/tmp/project', configPath: '/tmp/config.json', logDir: '/tmp/logs' });
  if (!xml.includes('<key>KeepAlive</key><true/>') || !xml.includes('<string>/tmp/config.json</string>')) throw new Error('LaunchAgent plist self-check failed.');
  if (escapeXml('a&b<c>') !== 'a&amp;b&lt;c&gt;') throw new Error('XML escaping self-check failed.');
  console.log('LaunchAgent installer self-check passed.');
  process.exit(0);
}

if (!configPath || !path.isAbsolute(configPath)) {
  throw new Error('Set COLONYOND_HYDRA_CRANKER_CONFIG to the absolute path of the official Hydra cranker fleet JSON config before installing.');
}
if (configPath.includes('\n') || configPath.includes('\0')) throw new Error('Cranker config path contains invalid characters.');

await mkdir(path.dirname(plistPath), { recursive: true });
await mkdir(logDir, { recursive: true });
await writeFile(plistPath, renderPlist({ nodePath: process.execPath, runnerPath, projectDir, configPath, logDir }), { mode: 0o600 });
console.log(`Installed ${plistPath}`);
console.log('The agent is not running. Start it when ready with:');
console.log(`launchctl bootstrap gui/$(id -u) '${plistPath}'`);

function renderPlist({ nodePath, runnerPath, projectDir, configPath, logDir }) {
  const args = [nodePath, runnerPath];
  const strings = (values) => values.map((value) => `<string>${escapeXml(value)}</string>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array>${strings(args)}</array>\n<key>WorkingDirectory</key><string>${escapeXml(projectDir)}</string>\n<key>EnvironmentVariables</key><dict><key>COLONYOND_HYDRA_CRANKER_CONFIG</key><string>${escapeXml(configPath)}</string></dict>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>StandardOutPath</key><string>${escapeXml(path.join(logDir, 'cranker.log'))}</string>\n<key>StandardErrorPath</key><string>${escapeXml(path.join(logDir, 'cranker-error.log'))}</string>\n</dict></plist>\n`;
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
