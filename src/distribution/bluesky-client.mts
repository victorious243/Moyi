import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import {
  JoseKey,
  Keyset,
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedState,
  type OAuthClientMetadataInput
} from '@atproto/oauth-client-node';
import { distributionConfig, isLocalBlueskyClient } from './config.mjs';

const require = createRequire(import.meta.url);
const SocialOAuthSession = require('../../models/SocialOAuthSession.js');
const { decrypt, encrypt } = require('../../utils/crypto.js');

const BLUESKY_SCOPE = 'atproto repo:app.bsky.feed.post?action=create blob:image/*';
let clientPromise: Promise<NodeOAuthClient> | null = null;

function metadata(): OAuthClientMetadataInput {
  const redirectUri = distributionConfig.blueskyRedirectUri;
  if (isLocalBlueskyClient()) {
    const clientId = new URL('http://localhost');
    clientId.searchParams.append('redirect_uri', redirectUri);
    clientId.searchParams.set('scope', BLUESKY_SCOPE);
    return {
      client_id: clientId.toString(),
      client_name: 'Moyi-CMO Development',
      client_uri: distributionConfig.appUrl,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'native',
      scope: BLUESKY_SCOPE,
      token_endpoint_auth_method: 'none',
      dpop_bound_access_tokens: true
    } as OAuthClientMetadataInput;
  }

  if (!distributionConfig.blueskyPrivateJwk) {
    throw new Error('Bluesky OAuth requires BLUESKY_PRIVATE_JWK in production. Run npm run generate:bluesky-key and add the result to the environment.');
  }

  return {
    client_id: `${distributionConfig.appUrl}/oauth-client-metadata.json`,
    client_name: 'Moyi-CMO',
    client_uri: distributionConfig.appUrl,
    logo_uri: `${distributionConfig.appUrl}/images/brand/moyi-mark-512.png`,
    tos_uri: `${distributionConfig.appUrl}/terms`,
    policy_uri: `${distributionConfig.appUrl}/privacy`,
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    scope: BLUESKY_SCOPE,
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    jwks_uri: `${distributionConfig.appUrl}/.well-known/jwks.json`,
    dpop_bound_access_tokens: true
  } as OAuthClientMetadataInput;
}

function encryptedStore<T>(kind: 'state' | 'session', ttlMs: number | null) {
  return {
    async get(key: string): Promise<T | undefined> {
      const record = await SocialOAuthSession.findOne({ platform: 'bluesky', kind, key }).select('+encryptedPayload').lean();
      if (!record) return undefined;
      if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
        await SocialOAuthSession.deleteOne({ _id: record._id });
        return undefined;
      }
      return JSON.parse(decrypt(record.encryptedPayload)) as T;
    },
    async set(key: string, value: T): Promise<void> {
      await SocialOAuthSession.updateOne(
        { platform: 'bluesky', kind, key },
        {
          $set: {
            encryptedPayload: encrypt(JSON.stringify(value)),
            expiresAt: ttlMs ? new Date(Date.now() + ttlMs) : null
          }
        },
        { upsert: true }
      );
    },
    async del(key: string): Promise<void> {
      await SocialOAuthSession.deleteOne({ platform: 'bluesky', kind, key });
    }
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestLock<T>(name: string, operation: () => T | PromiseLike<T>): Promise<T> {
  const owner = encrypt(crypto.randomUUID());
  let acquired = false;
  for (let attempt = 0; attempt < 40 && !acquired; attempt += 1) {
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
    const updated = await SocialOAuthSession.findOneAndUpdate(
      {
        platform: 'bluesky',
        kind: 'lock',
        key: name,
        $or: [{ expiresAt: { $lte: new Date() } }, { expiresAt: null }]
      },
      { $set: { encryptedPayload: owner, expiresAt } },
      { returnDocument: 'after' }
    );
    if (updated) {
      acquired = true;
      break;
    }
    try {
      await SocialOAuthSession.create({ platform: 'bluesky', kind: 'lock', key: name, encryptedPayload: owner, expiresAt });
      acquired = true;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      await wait(250);
    }
  }
  if (!acquired) throw new Error('Timed out waiting for the Bluesky OAuth session lock.');
  try {
    return await operation();
  } finally {
    await SocialOAuthSession.deleteOne({
      platform: 'bluesky',
      kind: 'lock',
      key: name,
      encryptedPayload: owner
    });
  }
}

async function createClient(): Promise<NodeOAuthClient> {
  let keyset: Keyset | undefined;
  if (!isLocalBlueskyClient()) {
    const key = await JoseKey.fromJWK(JSON.parse(distributionConfig.blueskyPrivateJwk));
    keyset = new Keyset([key]);
  }

  return new NodeOAuthClient({
    clientMetadata: metadata(),
    keyset,
    requestLock,
    stateStore: encryptedStore<NodeSavedState>('state', 15 * 60 * 1000),
    sessionStore: encryptedStore<NodeSavedSession>('session', null)
  });
}

export function getBlueskyOAuthClient(): Promise<NodeOAuthClient> {
  if (!clientPromise) clientPromise = createClient();
  return clientPromise;
}

export function getBlueskyClientMetadata(): OAuthClientMetadataInput {
  return metadata();
}

export async function getBlueskyJwks(): Promise<{ keys: unknown[] }> {
  if (!distributionConfig.blueskyPrivateJwk) return { keys: [] };
  const key = await JoseKey.fromJWK(JSON.parse(distributionConfig.blueskyPrivateJwk));
  return { keys: [key.publicJwk] };
}

export { BLUESKY_SCOPE };
