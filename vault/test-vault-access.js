const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createVaultSession } = require("./VaultSession");
const { createVaultAccess, ACCESS_ERROR_CODES } = require("./VaultAccess");
const { migrateVault, legacyVaultPath, encryptedVaultPath } = require("./VaultMigration");
const { encryptVaultPayload, writeEncryptedVaultAtomic } = require("./VaultCrypto");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mbrowser-vault-access-"));
}

function sampleLegacyVault() {
  return {
    version: 1,
    entries: [
      {
        id: "pw_a",
        origin: "https://example.test",
        url: "https://example.test/login",
        username: "user-a",
        password: "secret-a",
        notes: "",
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: "pw_b",
        origin: "https://other.test",
        url: "https://other.test/signin",
        username: "user-b",
        password: "secret-b",
        notes: "",
        createdAt: 2,
        updatedAt: 2
      }
    ]
  };
}

function writeLegacy(dir, vault) {
  fs.writeFileSync(legacyVaultPath(dir), JSON.stringify(vault, null, 2), "utf8");
}

function createAccess(dir, session) {
  return createVaultAccess({
    userDataPath: dir,
    getSession: () => session
  });
}

async function prepareMigratedVault(dir, masterPassword, legacyVault) {
  writeLegacy(dir, legacyVault);
  const session = createVaultSession({ userDataPath: dir });
  await session.setup(masterPassword, masterPassword);
  await migrateVault({ userDataPath: dir, session, masterPassword });
  return session;
}

async function testLegacyMatch() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  writeLegacy(dir, sampleLegacyVault());
  const access = createAccess(dir, session);

  const result = access.matchCredentials("https://example.test/login");
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.matches.length, 1);
  assert.strictEqual(result.data.matches[0].id, "pw_a");
  assert.strictEqual(result.data.matches[0].username, "user-a");

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testMatchReturnsOnlyIdUsername() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  writeLegacy(dir, sampleLegacyVault());
  const access = createAccess(dir, session);
  const result = access.matchCredentials("https://example.test");
  assert.deepStrictEqual(Object.keys(result.data.matches[0]).sort(), ["id", "username"]);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testMatchNeverContainsPassword() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  writeLegacy(dir, sampleLegacyVault());
  const access = createAccess(dir, session);
  const result = access.matchCredentials("https://example.test");
  assert.ok(!("password" in result.data.matches[0]));
  assert.ok(!JSON.stringify(result.data).includes("secret-a"));
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testNoMatchReturnsEmpty() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  writeLegacy(dir, sampleLegacyVault());
  const access = createAccess(dir, session);
  const result = access.matchCredentials("https://nomatch.test");
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.data.matches, []);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testWrongOriginMatchReturnsEmpty() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  writeLegacy(dir, sampleLegacyVault());
  const access = createAccess(dir, session);
  const result = access.matchCredentials("https://absent.test");
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.data.matches, []);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testLegacyRetrieveWithoutUnlock() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  writeLegacy(dir, sampleLegacyVault());
  const access = createAccess(dir, session);
  const result = access.retrieveCredentialForFill("pw_a", "https://example.test/login");
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.data, { username: "user-a", password: "secret-a" });
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testEncryptedRetrieveAfterMigration() {
  const dir = makeTempDir();
  const masterPassword = "vault-master";
  const session = await prepareMigratedVault(dir, masterPassword, sampleLegacyVault());
  const access = createAccess(dir, session);
  const result = access.retrieveCredentialForFill("pw_a", "https://example.test");
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.data, { username: "user-a", password: "secret-a" });
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testRetrieveReturnsExactlyOneCredential() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  writeLegacy(dir, sampleLegacyVault());
  const access = createAccess(dir, session);
  const result = access.retrieveCredentialForFill("pw_a", "https://example.test");
  assert.strictEqual(Object.keys(result.data).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testWrongOriginMismatch() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  writeLegacy(dir, sampleLegacyVault());
  const access = createAccess(dir, session);
  const result = access.retrieveCredentialForFill("pw_a", "https://other.test");
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.code, ACCESS_ERROR_CODES.ORIGIN_MISMATCH);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testNonexistentId() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  writeLegacy(dir, sampleLegacyVault());
  const access = createAccess(dir, session);
  const result = access.retrieveCredentialForFill("pw_missing", "https://example.test");
  assert.strictEqual(result.code, ACCESS_ERROR_CODES.CREDENTIAL_NOT_FOUND);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testInvalidRequest() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  const access = createAccess(dir, session);
  assert.strictEqual(access.matchCredentials("").code, ACCESS_ERROR_CODES.INVALID_REQUEST);
  assert.strictEqual(access.retrieveCredentialForFill("", "https://example.test").code, ACCESS_ERROR_CODES.INVALID_REQUEST);
  assert.strictEqual(access.retrieveCredentialForFill("pw_a", "").code, ACCESS_ERROR_CODES.INVALID_REQUEST);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testEncryptedLocked() {
  const dir = makeTempDir();
  const masterPassword = "vault-master";
  const session = await prepareMigratedVault(dir, masterPassword, sampleLegacyVault());
  session.lock();
  const access = createAccess(dir, session);
  const match = access.matchCredentials("https://example.test");
  const retrieve = access.retrieveCredentialForFill("pw_a", "https://example.test");
  assert.strictEqual(match.code, ACCESS_ERROR_CODES.VAULT_LOCKED);
  assert.strictEqual(retrieve.code, ACCESS_ERROR_CODES.VAULT_LOCKED);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testEncryptedCorrupt() {
  const dir = makeTempDir();
  const masterPassword = "vault-master";
  const session = await prepareMigratedVault(dir, masterPassword, sampleLegacyVault());
  fs.writeFileSync(encryptedVaultPath(dir), "{bad", "utf8");
  const access = createAccess(dir, session);
  const result = access.matchCredentials("https://example.test");
  assert.strictEqual(result.code, ACCESS_ERROR_CODES.VAULT_CORRUPT);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testEncryptedMissing() {
  const dir = makeTempDir();
  const masterPassword = "vault-master";
  const session = await prepareMigratedVault(dir, masterPassword, sampleLegacyVault());
  fs.unlinkSync(encryptedVaultPath(dir));
  const access = createAccess(dir, session);
  const result = access.retrieveCredentialForFill("pw_a", "https://example.test");
  assert.strictEqual(result.code, ACCESS_ERROR_CODES.VAULT_NOT_FOUND);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testPostMigrationNeverUsesPlaintext() {
  const dir = makeTempDir();
  const masterPassword = "vault-master";
  const session = await prepareMigratedVault(dir, masterPassword, sampleLegacyVault());
  writeLegacy(dir, {
    version: 1,
    entries: [{ id: "pw_fake", origin: "https://example.test", url: "https://example.test", username: "fake", password: "fake-pass" }]
  });
  const access = createAccess(dir, session);
  const result = access.retrieveCredentialForFill("pw_fake", "https://example.test");
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.code, ACCESS_ERROR_CODES.CREDENTIAL_NOT_FOUND);
  const valid = access.retrieveCredentialForFill("pw_a", "https://example.test");
  assert.strictEqual(valid.data.password, "secret-a");
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testNoFullVaultCrossesAccessLayer() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  writeLegacy(dir, sampleLegacyVault());
  const access = createAccess(dir, session);
  const match = access.matchCredentials("https://example.test");
  const retrieve = access.retrieveCredentialForFill("pw_a", "https://example.test");
  assert.ok(!("entries" in match.data));
  assert.ok(!("entries" in retrieve.data));
  const auth = access.getAuthoritativeEntries();
  assert.ok(Array.isArray(auth.entries));
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testNoSecretLogging() {
  const dir = makeTempDir();
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const session = createVaultSession({ userDataPath: dir });
    writeLegacy(dir, sampleLegacyVault());
    const access = createAccess(dir, session);
    access.matchCredentials("https://example.test");
    access.retrieveCredentialForFill("pw_a", "https://example.test");
    const combined = logs.join("\n");
    assert.ok(!combined.includes("secret-a"));
    assert.ok(!combined.includes("vault-master"));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function run() {
  await testLegacyMatch();
  await testMatchReturnsOnlyIdUsername();
  await testMatchNeverContainsPassword();
  await testNoMatchReturnsEmpty();
  await testWrongOriginMatchReturnsEmpty();
  await testLegacyRetrieveWithoutUnlock();
  await testEncryptedRetrieveAfterMigration();
  await testRetrieveReturnsExactlyOneCredential();
  await testWrongOriginMismatch();
  await testNonexistentId();
  await testInvalidRequest();
  await testEncryptedLocked();
  await testEncryptedCorrupt();
  await testEncryptedMissing();
  await testPostMigrationNeverUsesPlaintext();
  await testNoFullVaultCrossesAccessLayer();
  await testNoSecretLogging();
  console.log("vault/test-vault-access.js: all tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
