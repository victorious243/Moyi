#!/usr/bin/env node

const env = require('../config/env');

const readiness = env.socialProviderReadiness();

console.log('Moyi one-click social publishing readiness');
console.log('');

Object.entries(readiness.providers).forEach(([key, provider]) => {
  const status = provider.ready ? 'READY' : 'MISSING';
  console.log(`${provider.label} (${key}): ${status}`);
  console.log(`  Callback URL: ${provider.callbackUrl}`);

  if (provider.missingKeys.length) {
    console.log(`  Required env: ${provider.missingKeys.join(', ')}`);
  }

  if (provider.optionalMissingKeys.length) {
    console.log(`  Optional env: ${provider.optionalMissingKeys.join(', ')}`);
  }
});

console.log('');

if (!readiness.ready) {
  console.log('Next step: create/configure the provider apps, add the missing env vars, and add each callback URL above to its matching provider app.');
  process.exitCode = 1;
} else {
  console.log('All one-click social providers have the required local configuration.');
}
