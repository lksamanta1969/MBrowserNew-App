const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createVaultSession } = require("./VaultSession");
const {
  MIGRATION_ERROR_CODES,
  MIGRATION_STATES,
  isMigrationComplete,
  migrateVault,
  legacyVaultPath,
  encryptedVaultPath,
  readMigrationMarker,
  deepClone
} = require("./VaultMigration");
const { decryptVaultPayload, readEncryptedVaultFile } = require("./VaultCrypto");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mbrowser-vault-migration-"));
}

function sampleLegacyVault(extraEntryFields = {}) {
  return {
    version: 1,
    entries: [
      {
        id: "pw_test_1",
        origin: "https://example.test",
        url: "https://example.test/login",
        username: "user@test",
        password: "secret-value",
        notes: "note",
        createdAt: 10,
        updatedAt: 20,
        customField: "preserve-me",
        ...extraEntryFields
      }
    ]
  };
}

function writeLegacy(dir, vault) {
  fs.writeFileSync(legacyVaultPath(dir), JSON.stringify(vault, null, 2), "utf8");
}

async function preparePendingMigration(dir, masterPassword, legacyVault) {
  writeLegacy(dir, legacyVault);
  const session = createVaultSession({ userDataPath: dir });
  const setup = await session.setup(masterPassword, masterPassword);
  assert.strictEqual(setup.success, true);
  return session;
}

function simulateReadPasswordsStore(dir, session) {
  if (isMigrationComplete(dir)) {
    if (!session.isUnlocked()) {
      const error = new Error("Password vault is locked.");
      error.code = "VAULT_LOCKED";
      throw error;
    }
    const data = session.getDecryptedVault();
    if (!data) {
      const error = new Error("Password vault is unavailable.");
      error.code = "VAULT_UNAVAILABLE";
      throw error;
    }
    return deepClone(data);
  }

  const legacyPath = legacyVaultPath(dir);
  if (!fs.existsSync(legacyPath)) {
    const error = new Error("Would auto-create plaintext vault.");
    error.code = "PLAINTEXT_AUTOCREATE_BLOCKED";
    throw error;
  }
  return JSON.parse(fs.readFileSync(legacyPath, "utf8"));
}

async function simulateWritePasswordsStore(dir, session, data) {
  if (isMigrationComplete(dir)) {
    return session.persistDecryptedVault(data);
  }
  fs.writeFileSync(legacyVaultPath(dir), JSON.stringify(data, null, 2), "utf8");
  return data;
}

async function testSuccessfulFullMigration() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  const legacyVault = sampleLegacyVault();
  try {
    const session = await preparePendingMigration(dir, masterPassword, legacyVault);
    const result = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(result.success, true);
    assert.strictEqual(isMigrationComplete(dir), true);
    assert.strictEqual(fs.existsSync(legacyVaultPath(dir)), false);
    assert.strictEqual(fs.existsSync(encryptedVaultPath(dir)), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testExactDataPreservation() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  const legacyVault = sampleLegacyVault({ tag: "extra" });
  try {
    const session = await preparePendingMigration(dir, masterPassword, legacyVault);
    await migrateVault({ userDataPath: dir, session, masterPassword });
    const envelope = readEncryptedVaultFile(encryptedVaultPath(dir));
    const decrypted = await decryptVaultPayload(envelope, masterPassword);
    assert.deepStrictEqual(decrypted, legacyVault);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testBackupCreatedAndVerified() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  const legacyVault = sampleLegacyVault();
  try {
    const session = await preparePendingMigration(dir, masterPassword, legacyVault);
    await migrateVault({ userDataPath: dir, session, masterPassword });
    const marker = readMigrationMarker(dir);
    assert.ok(marker && marker.legacyBackupPath);
    const backupPath = path.join(dir, marker.legacyBackupPath);
    assert.ok(fs.existsSync(backupPath));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(backupPath, "utf8")), legacyVault);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testBackupFailureAborts() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  const legacyVault = sampleLegacyVault();
  const session = await preparePendingMigration(dir, masterPassword, legacyVault);
  const originalCopy = fs.copyFileSync;
  fs.copyFileSync = () => {
    throw new Error("backup failed");
  };
  try {
    const result = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, MIGRATION_ERROR_CODES.BACKUP_FAILED);
    assert.strictEqual(fs.existsSync(legacyVaultPath(dir)), true);
    assert.strictEqual(isMigrationComplete(dir), false);
  } finally {
    fs.copyFileSync = originalCopy;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testWriteFailureLeavesLegacyIntact() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  const legacyVault = sampleLegacyVault();
  const session = await preparePendingMigration(dir, masterPassword, legacyVault);
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = (...args) => {
    if (String(args[0]).includes(".tmp")) {
      throw new Error("write failed");
    }
    return originalWrite(...args);
  };
  try {
    const result = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, MIGRATION_ERROR_CODES.WRITE_FAILED);
    assert.strictEqual(fs.existsSync(legacyVaultPath(dir)), true);
  } finally {
    fs.writeFileSync = originalWrite;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testVerificationFailure() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  const legacyVault = sampleLegacyVault();
  const session = await preparePendingMigration(dir, masterPassword, legacyVault);
  const originalRead = fs.readFileSync;
  let encryptedReads = 0;
  fs.readFileSync = (target, ...rest) => {
    const buffer = originalRead(target, ...rest);
    if (String(target).endsWith("passwords.vault.json")) {
      encryptedReads += 1;
      if (encryptedReads >= 3) {
        const parsed = JSON.parse(buffer.toString("utf8"));
        parsed.ciphertext = "AAAA";
        return Buffer.from(JSON.stringify(parsed), "utf8");
      }
    }
    return buffer;
  };
  try {
    const result = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, MIGRATION_ERROR_CODES.VERIFICATION_FAILED);
    assert.strictEqual(fs.existsSync(legacyVaultPath(dir)), true);
    assert.strictEqual(isMigrationComplete(dir), false);
  } finally {
    fs.readFileSync = originalRead;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testLockedSessionPrevented() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  try {
    writeLegacy(dir, sampleLegacyVault());
    const session = createVaultSession({ userDataPath: dir });
    await session.setup(masterPassword, masterPassword);
    session.lock();
    const result = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, MIGRATION_ERROR_CODES.MASTER_PASSWORD_REQUIRED);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testWrongMasterPassword() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  try {
    const session = await preparePendingMigration(dir, masterPassword, sampleLegacyVault());
    const result = await migrateVault({ userDataPath: dir, session, masterPassword: "wrong" });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, MIGRATION_ERROR_CODES.WRONG_PASSWORD);
    assert.strictEqual(isMigrationComplete(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testInvalidLegacyRejected() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  try {
    fs.writeFileSync(legacyVaultPath(dir), "{bad", "utf8");
    const session = createVaultSession({ userDataPath: dir });
    await session.setup(masterPassword, masterPassword);
    const result = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, MIGRATION_ERROR_CODES.LEGACY_INVALID);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testIdempotentSecondMigration() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  try {
    const session = await preparePendingMigration(dir, masterPassword, sampleLegacyVault());
    const first = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(first.success, true);
    const second = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(second.success, true);
    assert.strictEqual(second.code, MIGRATION_ERROR_CODES.ALREADY_MIGRATED);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testEncryptedVaultHasDataBlocked() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  try {
    const legacyVault = sampleLegacyVault();
    writeLegacy(dir, legacyVault);
    const session = createVaultSession({ userDataPath: dir });
    await session.setup(masterPassword, masterPassword);
    await session.persistDecryptedVault({
      version: 1,
      entries: [{ id: "other", username: "x", password: "y", origin: "https://other.test" }]
    });
    await session.unlock(masterPassword);
    const result = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, MIGRATION_ERROR_CODES.ENCRYPTED_VAULT_HAS_DATA);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testRetryAfterVerificationSuccessBeforeMarker() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  const originalWriteMarker = fs.writeFileSync;
  let markerWriteAttempts = 0;
  fs.writeFileSync = (target, ...rest) => {
    if (String(target).includes("passwords.migration.json")) {
      markerWriteAttempts += 1;
      if (markerWriteAttempts === 1) {
        throw new Error("marker failed");
      }
    }
    return originalWriteMarker(target, ...rest);
  };
  try {
    const session = await preparePendingMigration(dir, masterPassword, sampleLegacyVault());
    const first = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(first.success, false);
    assert.strictEqual(first.code, MIGRATION_ERROR_CODES.MARKER_FAILED);
    assert.strictEqual(fs.existsSync(legacyVaultPath(dir)), false);
    assert.strictEqual(isMigrationComplete(dir), false);

    const retry = await migrateVault({ userDataPath: dir, session, masterPassword });
    assert.strictEqual(retry.success, true);
    assert.strictEqual(isMigrationComplete(dir), true);
  } finally {
    fs.writeFileSync = originalWriteMarker;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testNoSecretLeakage() {
  const dir = makeTempDir();
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const masterPassword = "secret-master";
    const session = await preparePendingMigration(dir, masterPassword, sampleLegacyVault());
    await migrateVault({ userDataPath: dir, session, masterPassword });
    const combined = logs.join("\n");
    assert.ok(!combined.includes("secret-master"));
    assert.ok(!combined.includes("secret-value"));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testPostMigrationCrudUsesEncryptedVault() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  try {
    const session = await preparePendingMigration(dir, masterPassword, sampleLegacyVault());
    await migrateVault({ userDataPath: dir, session, masterPassword });
    const data = simulateReadPasswordsStore(dir, session);
    assert.strictEqual(data.entries.length, 1);
    data.entries.push({
      id: "pw_new",
      origin: "https://new.test",
      url: "https://new.test",
      username: "new",
      password: "new-pass",
      notes: "",
      createdAt: 1,
      updatedAt: 1
    });
    await simulateWritePasswordsStore(dir, session, data);
    const envelope = readEncryptedVaultFile(encryptedVaultPath(dir));
    const decrypted = await decryptVaultPayload(envelope, masterPassword);
    assert.strictEqual(decrypted.entries.length, 2);
    assert.strictEqual(fs.existsSync(legacyVaultPath(dir)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testPostMigrationLockedDoesNotRecreatePlaintext() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  try {
    const session = await preparePendingMigration(dir, masterPassword, sampleLegacyVault());
    await migrateVault({ userDataPath: dir, session, masterPassword });
    session.lock();
    assert.throws(
      () => simulateReadPasswordsStore(dir, session),
      (error) => error.code === "VAULT_LOCKED"
    );
    assert.strictEqual(fs.existsSync(legacyVaultPath(dir)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testPostMigrationMissingPlaintextDoesNotRecreate() {
  const dir = makeTempDir();
  const masterPassword = "migrate-master";
  try {
    const session = await preparePendingMigration(dir, masterPassword, sampleLegacyVault());
    await migrateVault({ userDataPath: dir, session, masterPassword });
    session.lock();
    assert.strictEqual(fs.existsSync(legacyVaultPath(dir)), false);
    assert.throws(
      () => simulateReadPasswordsStore(dir, session),
      (error) => error.code === "VAULT_LOCKED"
    );
    assert.strictEqual(fs.existsSync(legacyVaultPath(dir)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function run() {
  await testSuccessfulFullMigration();
  await testExactDataPreservation();
  await testBackupCreatedAndVerified();
  await testBackupFailureAborts();
  await testWriteFailureLeavesLegacyIntact();
  await testVerificationFailure();
  await testLockedSessionPrevented();
  await testWrongMasterPassword();
  await testInvalidLegacyRejected();
  await testIdempotentSecondMigration();
  await testEncryptedVaultHasDataBlocked();
  await testRetryAfterVerificationSuccessBeforeMarker();
  await testNoSecretLeakage();
  await testPostMigrationCrudUsesEncryptedVault();
  await testPostMigrationLockedDoesNotRecreatePlaintext();
  await testPostMigrationMissingPlaintextDoesNotRecreate();
  console.log("vault/test-vault-migration.js: all tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
