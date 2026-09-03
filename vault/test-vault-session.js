const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  SESSION_ERROR_CODES,
  VAULT_MODES,
  createVaultSession
} = require("./VaultSession");
const { isEncryptedVaultEnvelope } = require("./VaultCrypto");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mbrowser-vault-session-"));
}

function writeLegacyVault(dir, entries = []) {
  const filePath = path.join(dir, "passwords.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify({ version: 1, entries }, null, 2),
    "utf8"
  );
  return filePath;
}

async function testValidSetup() {
  const dir = makeTempDir();
  try {
    const session = createVaultSession({ userDataPath: dir });
    const result = await session.setup("master-password", "master-password");

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.mode, VAULT_MODES.ENCRYPTED_UNLOCKED);
    assert.strictEqual(result.data.unlocked, true);
    assert.ok(fs.existsSync(session.getPaths().encryptedPath));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testEmptyPasswordRejection() {
  const dir = makeTempDir();
  try {
    const session = createVaultSession({ userDataPath: dir });
    const result = await session.setup("", "");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, SESSION_ERROR_CODES.PASSWORD_REQUIRED);
    assert.strictEqual(session.isUnlocked(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testConfirmationMismatch() {
  const dir = makeTempDir();
  try {
    const session = createVaultSession({ userDataPath: dir });
    const result = await session.setup("alpha", "beta");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, SESSION_ERROR_CODES.PASSWORD_MISMATCH);
    assert.strictEqual(fs.existsSync(session.getPaths().encryptedPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testEncryptedFileHasNoPlaintextMasterPassword() {
  const dir = makeTempDir();
  const masterPassword = "vault-master-secret";
  try {
    const session = createVaultSession({ userDataPath: dir });
    await session.setup(masterPassword, masterPassword);
    const raw = fs.readFileSync(session.getPaths().encryptedPath, "utf8");
    const parsed = JSON.parse(raw);

    assert.strictEqual(isEncryptedVaultEnvelope(parsed), true);
    assert.ok(!raw.includes(masterPassword));
    assert.ok(!raw.includes('"password"'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testCorrectUnlock() {
  const dir = makeTempDir();
  try {
    const session = createVaultSession({ userDataPath: dir });
    await session.setup("unlock-me", "unlock-me");
    session.lock();

    const result = await session.unlock("unlock-me");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.unlocked, true);
    assert.strictEqual(session.isUnlocked(), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testWrongPassword() {
  const dir = makeTempDir();
  try {
    const session = createVaultSession({ userDataPath: dir });
    await session.setup("correct", "correct");
    session.lock();

    const result = await session.unlock("wrong");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, SESSION_ERROR_CODES.WRONG_PASSWORD);
    assert.strictEqual(session.isUnlocked(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testFailedUnlockRemainsLocked() {
  const dir = makeTempDir();
  try {
    const session = createVaultSession({ userDataPath: dir });
    await session.setup("correct", "correct");

    const fail = await session.unlock("wrong");
    assert.strictEqual(fail.success, false);
    assert.strictEqual(session.isUnlocked(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testSessionStateIsInMemory() {
  const dir = makeTempDir();
  try {
    const sessionA = createVaultSession({ userDataPath: dir });
    await sessionA.setup("session-test", "session-test");
    assert.strictEqual(sessionA.isUnlocked(), true);

    const sessionB = createVaultSession({ userDataPath: dir });
    assert.strictEqual(sessionB.isUnlocked(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testExplicitLock() {
  const dir = makeTempDir();
  try {
    const session = createVaultSession({ userDataPath: dir });
    await session.setup("lock-test", "lock-test");
    assert.strictEqual(session.isUnlocked(), true);

    const locked = session.lock();
    assert.strictEqual(locked.success, true);
    assert.strictEqual(locked.data.unlocked, false);
    assert.strictEqual(session.isUnlocked(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testFreshSessionStartsLocked() {
  const dir = makeTempDir();
  try {
    const session = createVaultSession({ userDataPath: dir });
    const status = session.getStatus();
    assert.strictEqual(status.data.unlocked, false);
    assert.strictEqual(session.isUnlocked(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    await session.setup("secret-master", "secret-master");
    session.lock();
    await session.unlock("secret-master");
    await session.unlock("wrong-secret");

    const combined = logs.join("\n");
    assert.ok(!combined.includes("secret-master"));
    assert.ok(!combined.includes("wrong-secret"));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testDuplicateSetupRejection() {
  const dir = makeTempDir();
  try {
    const session = createVaultSession({ userDataPath: dir });
    const first = await session.setup("first", "first");
    assert.strictEqual(first.success, true);

    const second = await session.setup("second", "second");
    assert.strictEqual(second.success, false);
    assert.strictEqual(second.code, SESSION_ERROR_CODES.SETUP_ALREADY_COMPLETE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testLegacyCoexistenceUntouched() {
  const dir = makeTempDir();
  try {
    writeLegacyVault(dir, [
      {
        id: "pw_1",
        origin: "https://example.test",
        url: "https://example.test",
        username: "legacy-user",
        password: "legacy-secret",
        notes: "",
        createdAt: 1,
        updatedAt: 1
      }
    ]);

    const legacyRawBefore = fs.readFileSync(path.join(dir, "passwords.json"), "utf8");
    const session = createVaultSession({ userDataPath: dir });
    const setup = await session.setup("vault-pass", "vault-pass");

    assert.strictEqual(setup.success, true);
    assert.strictEqual(setup.data.mode, VAULT_MODES.LEGACY_WITH_VAULT);
    assert.strictEqual(setup.data.legacyVaultPresent, true);
    assert.strictEqual(setup.data.encryptedVaultPresent, true);

    const legacyRawAfter = fs.readFileSync(path.join(dir, "passwords.json"), "utf8");
    assert.strictEqual(legacyRawBefore, legacyRawAfter);
    assert.ok(legacyRawAfter.includes("legacy-secret"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testMalformedVaultErrorMode() {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, "passwords.vault.json"), "{bad", "utf8");
    const session = createVaultSession({ userDataPath: dir });
    const status = session.getStatus();
    assert.strictEqual(status.data.mode, VAULT_MODES.ENCRYPTED_ERROR);
    assert.strictEqual(status.data.unlocked, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function run() {
  await testValidSetup();
  await testEmptyPasswordRejection();
  await testConfirmationMismatch();
  await testEncryptedFileHasNoPlaintextMasterPassword();
  await testCorrectUnlock();
  await testWrongPassword();
  await testFailedUnlockRemainsLocked();
  await testSessionStateIsInMemory();
  await testExplicitLock();
  await testFreshSessionStartsLocked();
  await testNoSecretLogging();
  await testDuplicateSetupRejection();
  await testLegacyCoexistenceUntouched();
  await testMalformedVaultErrorMode();
  console.log("vault/test-vault-session.js: all tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
