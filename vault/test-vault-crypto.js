const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  FORMAT_ID,
  FORMAT_VERSION,
  SALT_LENGTH,
  ERROR_CODES,
  VaultCryptoError,
  deriveKey,
  encryptVaultPayload,
  decryptVaultPayload,
  parseEncryptedVault,
  validateEncryptedEnvelope,
  isEncryptedVaultEnvelope,
  isLegacyPlaintextVault,
  writeEncryptedVaultAtomic,
  readEncryptedVaultFile
} = require("./VaultCrypto");

function sampleVaultPayload() {
  return {
    version: 1,
    entries: [
      {
        id: "pw_test_1",
        origin: "https://example.test",
        url: "https://example.test/login",
        username: "user@test",
        password: "secret-value",
        notes: "",
        createdAt: 1,
        updatedAt: 1
      }
    ]
  };
}

async function testKeyDerivation() {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const keyA = await deriveKey("master-password", salt);
  const keyB = await deriveKey("master-password", salt);
  const keyC = await deriveKey("other-password", salt);

  assert.strictEqual(keyA.length, 32);
  assert.ok(keyA.equals(keyB), "Same password + salt should derive identical keys.");
  assert.ok(!keyA.equals(keyC), "Different passwords should derive different keys.");
}

async function testEncryptDecryptRoundTrip() {
  const payload = sampleVaultPayload();
  const envelope = await encryptVaultPayload(payload, "vault-master");

  assert.strictEqual(envelope.format, FORMAT_ID);
  assert.strictEqual(envelope.version, FORMAT_VERSION);
  assert.ok(typeof envelope.ciphertext === "string");
  assert.ok(envelope.ciphertext.length > 0);
  assert.ok(!envelope.ciphertext.includes("secret-value"));

  const decrypted = await decryptVaultPayload(envelope, "vault-master");
  assert.deepStrictEqual(decrypted, payload);
}

async function testWrongPasswordFailure() {
  const envelope = await encryptVaultPayload(sampleVaultPayload(), "correct-password");

  await assert.rejects(
    () => decryptVaultPayload(envelope, "wrong-password"),
    (error) => error instanceof VaultCryptoError && error.code === ERROR_CODES.DECRYPT_FAILED
  );
}

async function testTamperedCiphertextFailure() {
  const envelope = await encryptVaultPayload(sampleVaultPayload(), "vault-master");
  const tampered = JSON.parse(JSON.stringify(envelope));
  const bytes = Buffer.from(tampered.ciphertext, "base64");
  bytes[0] = bytes[0] ^ 0xff;
  tampered.ciphertext = bytes.toString("base64");

  await assert.rejects(
    () => decryptVaultPayload(tampered, "vault-master"),
    (error) => error instanceof VaultCryptoError && error.code === ERROR_CODES.DECRYPT_FAILED
  );
}

function testMalformedEncryptedFileRejection() {
  assert.throws(
    () => parseEncryptedVault("{not-json"),
    (error) => error instanceof VaultCryptoError && error.code === ERROR_CODES.MALFORMED
  );

  assert.throws(
    () => parseEncryptedVault(JSON.stringify({ format: "other", version: 1 })),
    (error) => error instanceof VaultCryptoError && error.code === ERROR_CODES.MALFORMED
  );

  assert.throws(
    () => validateEncryptedEnvelope({ format: FORMAT_ID, version: 99, kdf: {}, cipher: {}, ciphertext: "x" }),
    (error) => error instanceof VaultCryptoError && error.code === ERROR_CODES.UNSUPPORTED_VERSION
  );
}

async function testVersionAndFormatValidation() {
  const envelope = await encryptVaultPayload({ version: 1, entries: [] }, "vault-master");
  assert.strictEqual(isEncryptedVaultEnvelope(envelope), true);
  assert.strictEqual(isLegacyPlaintextVault(envelope), false);
  assert.strictEqual(isLegacyPlaintextVault(sampleVaultPayload()), true);

  const parsed = parseEncryptedVault(JSON.stringify(envelope));
  assert.deepStrictEqual(parsed.format, FORMAT_ID);
  assert.deepStrictEqual(parsed.version, FORMAT_VERSION);
}

async function testAtomicWriteBehavior() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mbrowser-vault-test-"));
  const targetPath = path.join(tempDir, "passwords.enc.json");

  try {
    const envelope = await encryptVaultPayload(sampleVaultPayload(), "vault-master");
    writeEncryptedVaultAtomic(targetPath, envelope);

    assert.ok(fs.existsSync(targetPath));
    assert.ok(!fs.readdirSync(tempDir).some((name) => name.endsWith(".tmp")));

    const loaded = readEncryptedVaultFile(targetPath);
    const decrypted = await decryptVaultPayload(loaded, "vault-master");
    assert.strictEqual(decrypted.entries.length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function run() {
  await testKeyDerivation();
  await testEncryptDecryptRoundTrip();
  await testWrongPasswordFailure();
  await testTamperedCiphertextFailure();
  testMalformedEncryptedFileRejection();
  await testVersionAndFormatValidation();
  await testAtomicWriteBehavior();
  console.log("vault/test-vault-crypto.js: all tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
