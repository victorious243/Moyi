const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isDisposableEmail,
  verifyEmailDomainMx,
  checkContactRateLimit,
  validateContactSubmission
} = require('../services/emailSecurityService');

test('isDisposableEmail: blocks known temporary and throwaway email domains', () => {
  assert.equal(isDisposableEmail('test@mailinator.com'), true);
  assert.equal(isDisposableEmail('user123@tempmail.com'), true);
  assert.equal(isDisposableEmail('fake@10minutemail.com'), true);
  assert.equal(isDisposableEmail('bot@guerrillamail.com'), true);
  assert.equal(isDisposableEmail('burner@sharklasers.com'), true);

  // Legitimate email domains
  assert.equal(isDisposableEmail('founder@moyi-cmo.com'), false);
  assert.equal(isDisposableEmail('user@gmail.com'), false);
  assert.equal(isDisposableEmail('lead@company.co.uk'), false);
});

test('verifyEmailDomainMx: accepts legitimate domains and rejects invalid domains', async () => {
  // Major trusted domains
  const gmailCheck = await verifyEmailDomainMx('test@gmail.com');
  assert.equal(gmailCheck.valid, true);

  const outlookCheck = await verifyEmailDomainMx('user@outlook.com');
  assert.equal(outlookCheck.valid, true);

  // Invalid syntax or non-existent TLD
  const invalidTldCheck = await verifyEmailDomainMx('user@domain');
  assert.equal(invalidTldCheck.valid, false);

  const fakeDomainCheck = await verifyEmailDomainMx('spammer@non-existent-fake-domain-987654321.invalid');
  assert.equal(fakeDomainCheck.valid, false);
  assert.ok(fakeDomainCheck.reason.includes('MX'));
});

test('checkContactRateLimit: allows normal volume and restricts abusive spam flooding', () => {
  const testIp = '192.168.100.50';

  // First 5 submissions should succeed
  for (let i = 0; i < 5; i++) {
    const res = checkContactRateLimit(testIp);
    assert.equal(res.allowed, true);
  }

  // 6th submission in same window should be blocked
  const blockedRes = checkContactRateLimit(testIp);
  assert.equal(blockedRes.allowed, false);
  assert.ok(blockedRes.reason.includes('Too many'));
});

test('validateContactSubmission: blocks honeypots, disposable emails, and non-MX domains', async () => {
  // 1. Blocked by honeypot
  const honeypotRes = await validateContactSubmission({
    email: 'real@gmail.com',
    name: 'Spam Bot',
    message: 'Buy cheap watches',
    website: 'http://spamlink.xyz',
    clientIp: '10.0.0.1'
  });
  assert.equal(honeypotRes.valid, false);

  // 2. Blocked by disposable email
  const disposableRes = await validateContactSubmission({
    email: 'fake@mailinator.com',
    name: 'Temp User',
    message: 'Hello Moyi',
    website: '',
    clientIp: '10.0.0.2'
  });
  assert.equal(disposableRes.valid, false);
  assert.ok(disposableRes.reason.includes('Disposable'));

  // 3. Blocked by non-existent domain
  const fakeDomainRes = await validateContactSubmission({
    email: 'fake@fake-invalid-domain-000000000000000000.invalid',
    name: 'Fake Person',
    message: 'Hello',
    website: '',
    clientIp: '10.0.0.3'
  });
  assert.equal(fakeDomainRes.valid, false);

  // 4. Valid submission
  const validRes = await validateContactSubmission({
    email: 'legit.founder@gmail.com',
    name: 'Real Founder',
    message: 'Interested in Moyi Agency plan',
    website: '',
    clientIp: '10.0.0.4'
  });
  assert.equal(validRes.valid, true);
});
