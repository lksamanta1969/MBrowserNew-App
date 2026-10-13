const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createVaultSession } = require("./VaultSession");
const {
  readPasswordVaultPayload,
  encryptedVaultBlocksPlaintextSideEffects
} = require("./VaultAuthority");
const { legacyVaultPath, encryptedVaultPath } = require("./VaultMigration");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mbrowser-vault-authority-"));
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
      }
    ]
  };
}

async function preparePending(dir, masterPassword, legacyVault) {
  fs.writeFileSync(legacyVaultPath(dir), JSON.stringify(legacyVault, null, 2), "utf8");
  const session = createVaultSession({ userDataPath: dir });
  await session.setup(masterPassword, masterPassword);
  return session;
}

async function testPendingLockedManagerReadDenied() {
  const dir = makeTempDir();
  const session = await preparePending(dir, "vault-master", sampleLegacyVault());
  session.lock();
  assert.throws(
    () => readPasswordVaultPayload(dir, () => session),
    (error) => error.code === "VAULT_LOCKED"
  );
  assert.strictEqual(encryptedVaultBlocksPlaintextSideEffects(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testPendingUnlockedManagerReadAllowed() {
  const dir = makeTempDir();
  const session = await preparePending(dir, "vault-master", sampleLegacyVault());
  const payload = readPasswordVaultPayload(dir, () => session);
  assert.strictEqual(payload.entries.length, 1);
  assert.strictEqual(payload.entries[0].username, "user-a");
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testCorruptEncryptedManagerReadDenied() {
  const dir = makeTempDir();
  const session = await preparePending(dir, "vault-master", sampleLegacyVault());
  fs.writeFileSync(encryptedVaultPath(dir), "{bad", "utf8");
  assert.throws(
    () => readPasswordVaultPayload(dir, () => session),
    (error) => error.code === "VAULT_CORRUPT"
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testLegacyOnlyUnchanged() {
  const dir = makeTempDir();
  const session = createVaultSession({ userDataPath: dir });
  fs.writeFileSync(legacyVaultPath(dir), JSON.stringify(sampleLegacyVault(), null, 2), "utf8");
  const payload = readPasswordVaultPayload(dir, () => session);
  assert.strictEqual(payload.entries.length, 1);
  assert.strictEqual(encryptedVaultBlocksPlaintextSideEffects(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function run() {
  await testPendingLockedManagerReadDenied();
  await testPendingUnlockedManagerReadAllowed();
  await testCorruptEncryptedManagerReadDenied();
  await testLegacyOnlyUnchanged();
  console.log("vault/test-vault-authority.js: all tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
