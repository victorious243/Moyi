#!/usr/bin/env node

import crypto from 'node:crypto';

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
jwk.alg = 'ES256';
jwk.kid = crypto.randomUUID();
jwk.use = 'sig';

process.stdout.write(`${JSON.stringify(jwk)}\n`);
