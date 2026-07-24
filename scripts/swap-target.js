#!/usr/bin/env node
// Swap package.json between the Electron app manifest and the VS Code
// extension manifest. The current manifest is saved back to its variant
// file first, so edits are never lost and the variants cannot drift.
//
//   npm run use:vscode    — switch package.json to the VS Code manifest
//   npm run use:electron  — switch package.json to the Electron manifest
//
// Run `npm install` after swapping (dependency sets differ).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');

const TARGETS = {
  electron: { name: 'pixel-agents-desktop', file: 'package-electron.json' },
  vscode: { name: 'pixel-agents', file: 'package-vscode.json' },
};

const requested = process.argv[2];
if (!TARGETS[requested]) {
  console.error('Usage: node scripts/swap-target.js <electron|vscode>');
  process.exit(1);
}

const current = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const currentTarget = Object.keys(TARGETS).find((t) => TARGETS[t].name === current.name);
if (!currentTarget) {
  console.error(`package.json name "${current.name}" matches no known target — aborting.`);
  process.exit(1);
}
if (currentTarget === requested) {
  console.log(`Already on the ${requested} manifest — nothing to do.`);
  process.exit(0);
}

const incoming = path.join(ROOT, TARGETS[requested].file);
if (!fs.existsSync(incoming)) {
  console.error(`${TARGETS[requested].file} not found — cannot swap.`);
  process.exit(1);
}

// Save the live manifest back to its variant file, then swap in the other.
fs.writeFileSync(path.join(ROOT, TARGETS[currentTarget].file), fs.readFileSync(PKG));
fs.copyFileSync(incoming, PKG);
console.log(`Switched package.json: ${currentTarget} -> ${requested}.`);
console.log('Now run: npm install');
console.log('Note: do not commit while swapped to a non-default target without meaning to.');
