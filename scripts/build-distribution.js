#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const tscBin = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
const tscPath = path.join(__dirname, '..', 'node_modules', '.bin', tscBin);

if (!fs.existsSync(tscPath)) {
  if (process.env.REQUIRE_DISTRIBUTION_BUILD === 'true') {
    console.error('TypeScript compiler is required, but it is not installed. Install development dependencies before building.');
    process.exit(1);
  }
  console.log('TypeScript compiler skipped (dev dependency omitted in production).');
  process.exit(0);
}

execFileSync(tscPath, ['-p', 'tsconfig.distribution.json'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit'
});
