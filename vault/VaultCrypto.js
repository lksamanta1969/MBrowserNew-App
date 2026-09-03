/**
 * MBrowser encrypted password vault — main-process crypto foundation (Phase 1E-D.1).
 * AES-256-GCM + scrypt KDF. No renderer/preload exposure.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const scryptAsync = promisify(crypto.scrypt);

const FORMAT_ID = "mbrowser-vault";
const FORMAT_VERSION = 1;

const KDF_ALGORITHM = "scrypt";
const CIPHER_ALGORITHM = "aes-256-gcm";

const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const ERROR_CODES = Object.freeze({
  MALFORMED: "MALFORMED",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  DECRYPT_FAILED: "DECRYPT_FAILED",
  NOT_FOUND: "NOT_FOUND",
  INVALID_PAYLOAD: "INVALID_PAYLOAD"
});

class VaultCryptoError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "VaultCryptoError";
    this.code = code;
  }
}

function toBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function fromBase64(value, fieldName, expectedLength) {
  if (typeof value !== "string" || !value.length) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, `${fieldName} must be a non-empty base64 string.`);
  }

  let buffer;
  try {
    buffer = Buffer.from(value, "base64");
  } catch (error) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, `${fieldName} is not valid base64.`);
  }

  if (expectedLength != null && buffer.length !== expectedLength) {
    throw new VaultCryptoError(
      ERROR_CODES.MALFORMED,
      `${fieldName} must decode to ${expectedLength} bytes.`
    );
  }

  return buffer;
}

function defaultKdfParams(saltBuffer) {
  return {
    algorithm: KDF_ALGORITHM,
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: toBase64(saltBuffer),
    keyLength: KEY_LENGTH
  };
}

function normalizeMasterPassword(masterPassword) {
  if (typeof masterPassword !== "string" || !masterPassword.length) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Master password is required.");
  }
  return masterPassword;
}

function readKdfParams(envelope) {
  const kdf = envelope && envelope.kdf;
  if (!kdf || typeof kdf !== "object") {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Missing kdf block.");
  }
  if (kdf.algorithm !== KDF_ALGORITHM) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Unsupported KDF algorithm.");
  }
  if (kdf.N !== SCRYPT_N || kdf.r !== SCRYPT_R || kdf.p !== SCRYPT_P || kdf.keyLength !== KEY_LENGTH) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Unsupported KDF parameters.");
  }

  const salt = fromBase64(kdf.salt, "kdf.salt", SALT_LENGTH);
  return { salt, N: kdf.N, r: kdf.r, p: kdf.p, keyLength: kdf.keyLength };
}

function readCipherParams(envelope) {
  const cipher = envelope && envelope.cipher;
  if (!cipher || typeof cipher !== "object") {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Missing cipher block.");
  }
  if (cipher.algorithm !== CIPHER_ALGORITHM) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Unsupported cipher algorithm.");
  }

  const iv = fromBase64(cipher.iv, "cipher.iv", IV_LENGTH);
  const tag = fromBase64(cipher.tag, "cipher.tag", TAG_LENGTH);
  return { iv, tag };
}

function validateEncryptedEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Encrypted vault envelope must be an object.");
  }
  if (envelope.format !== FORMAT_ID) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Unknown vault format identifier.");
  }
  if (typeof envelope.version !== "number" || !Number.isInteger(envelope.version)) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Vault version must be an integer.");
  }
  if (envelope.version !== FORMAT_VERSION) {
    throw new VaultCryptoError(ERROR_CODES.UNSUPPORTED_VERSION, "Unsupported encrypted vault version.");
  }
  if (typeof envelope.ciphertext !== "string" || !envelope.ciphertext.length) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Missing ciphertext.");
  }

  readKdfParams(envelope);
  readCipherParams(envelope);
  fromBase64(envelope.ciphertext, "ciphertext");

  return envelope;
}

function isEncryptedVaultEnvelope(value) {
  try {
    validateEncryptedEnvelope(value);
    return true;
  } catch (error) {
    return false;
  }
}

function isLegacyPlaintextVault(value) {
  return !!(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.format !== FORMAT_ID &&
    Array.isArray(value.entries)
  );
}

async function deriveKey(masterPassword, saltBuffer, kdfParams = {}) {
  normalizeMasterPassword(masterPassword);

  const N = kdfParams.N != null ? kdfParams.N : SCRYPT_N;
  const r = kdfParams.r != null ? kdfParams.r : SCRYPT_R;
  const p = kdfParams.p != null ? kdfParams.p : SCRYPT_P;
  const keyLength = kdfParams.keyLength != null ? kdfParams.keyLength : KEY_LENGTH;

  if (!Buffer.isBuffer(saltBuffer) || saltBuffer.length !== SALT_LENGTH) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Salt must be a 32-byte buffer.");
  }

  return scryptAsync(masterPassword, saltBuffer, keyLength, { N, r, p, maxmem: 128 * 1024 * 1024 });
}

async function encryptVaultPayload(payload, masterPassword) {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new VaultCryptoError(ERROR_CODES.INVALID_PAYLOAD, "Vault payload must be a plain object.");
  }

  normalizeMasterPassword(masterPassword);

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = await deriveKey(masterPassword, salt);

  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  key.fill(0);

  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    kdf: defaultKdfParams(salt),
    cipher: {
      algorithm: CIPHER_ALGORITHM,
      iv: toBase64(iv),
      tag: toBase64(tag)
    },
    ciphertext: toBase64(encrypted)
  };
}

async function decryptVaultPayload(envelope, masterPassword) {
  const validated = validateEncryptedEnvelope(envelope);
  normalizeMasterPassword(masterPassword);

  const { salt, N, r, p, keyLength } = readKdfParams(validated);
  const { iv, tag } = readCipherParams(validated);
  const ciphertext = fromBase64(validated.ciphertext, "ciphertext");

  let key;
  try {
    key = await deriveKey(masterPassword, salt, { N, r, p, keyLength });
    const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    key.fill(0);

    let payload;
    try {
      payload = JSON.parse(decrypted.toString("utf8"));
    } catch (error) {
      throw new VaultCryptoError(ERROR_CODES.INVALID_PAYLOAD, "Decrypted vault payload is not valid JSON.");
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new VaultCryptoError(ERROR_CODES.INVALID_PAYLOAD, "Decrypted vault payload must be an object.");
    }

    return payload;
  } catch (error) {
    if (key) key.fill(0);
    if (error instanceof VaultCryptoError) throw error;
    throw new VaultCryptoError(ERROR_CODES.DECRYPT_FAILED, "Vault decryption failed.");
  }
}

function serializeEncryptedVault(envelope) {
  validateEncryptedEnvelope(envelope);
  return JSON.stringify(envelope, null, 2);
}

function parseEncryptedVault(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Encrypted vault input must be a non-empty string.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Encrypted vault file is not valid JSON.");
  }

  return validateEncryptedEnvelope(parsed);
}

function writeEncryptedVaultAtomic(filePath, envelope) {
  validateEncryptedEnvelope(envelope);

  const targetPath = String(filePath || "").trim();
  if (!targetPath) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Encrypted vault file path is required.");
  }

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );
  const payload = serializeEncryptedVault(envelope);

  try {
    fs.writeFileSync(tmpPath, payload, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, targetPath);
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (cleanupError) {
      /* ignore cleanup failure */
    }
    throw error;
  }
}

function readEncryptedVaultFile(filePath) {
  const targetPath = String(filePath || "").trim();
  if (!targetPath) {
    throw new VaultCryptoError(ERROR_CODES.MALFORMED, "Encrypted vault file path is required.");
  }
  if (!fs.existsSync(targetPath)) {
    throw new VaultCryptoError(ERROR_CODES.NOT_FOUND, "Encrypted vault file not found.");
  }

  const raw = fs.readFileSync(targetPath, "utf8");
  return parseEncryptedVault(raw);
}

module.exports = {
  FORMAT_ID,
  FORMAT_VERSION,
  KDF_ALGORITHM,
  CIPHER_ALGORITHM,
  KEY_LENGTH,
  SALT_LENGTH,
  IV_LENGTH,
  TAG_LENGTH,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  ERROR_CODES,
  VaultCryptoError,
  deriveKey,
  encryptVaultPayload,
  decryptVaultPayload,
  serializeEncryptedVault,
  parseEncryptedVault,
  validateEncryptedEnvelope,
  isEncryptedVaultEnvelope,
  isLegacyPlaintextVault,
  writeEncryptedVaultAtomic,
  readEncryptedVaultFile
};
