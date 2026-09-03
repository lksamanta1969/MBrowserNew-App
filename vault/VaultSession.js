/**
 * MBrowser encrypted vault session — main-process unlock lifecycle (Phase 1E-D.2).
 * Master password and derived keys are never stored. Unlock state is in-memory only.
 */

const fs = require("fs");
const path = require("path");

const {
  VaultCryptoError,
  ERROR_CODES,
  encryptVaultPayload,
  decryptVaultPayload,
  isLegacyPlaintextVault,
  readEncryptedVaultFile,
  writeEncryptedVaultAtomic
} = require("./VaultCrypto");

const SESSION_ERROR_CODES = Object.freeze({
  SETUP_ALREADY_COMPLETE: "SETUP_ALREADY_COMPLETE",
  PASSWORD_REQUIRED: "PASSWORD_REQUIRED",
  PASSWORD_MISMATCH: "PASSWORD_MISMATCH",
  WRONG_PASSWORD: "WRONG_PASSWORD",
  VAULT_CORRUPT: "VAULT_CORRUPT",
  VAULT_NOT_FOUND: "VAULT_NOT_FOUND",
  NO_ENCRYPTED_VAULT: "NO_ENCRYPTED_VAULT"
});

const VAULT_MODES = Object.freeze({
  SETUP_REQUIRED: "setup_required",
  LEGACY: "legacy",
  LEGACY_WITH_VAULT: "legacy_with_vault",
  ENCRYPTED_LOCKED: "encrypted_locked",
  ENCRYPTED_UNLOCKED: "encrypted_unlocked",
  ENCRYPTED_ERROR: "encrypted_error"
});

const LEGACY_FILENAME = "passwords.json";
const ENCRYPTED_FILENAME = "passwords.vault.json";

function emptyVaultPayload() {
  return { version: 1, entries: [] };
}

function normalizePasswordInput(value) {
  return typeof value === "string" ? value : "";
}

function mapCryptoError(error) {
  if (!(error instanceof VaultCryptoError)) {
    return SESSION_ERROR_CODES.VAULT_CORRUPT;
  }
  if (error.code === ERROR_CODES.DECRYPT_FAILED) {
    return SESSION_ERROR_CODES.WRONG_PASSWORD;
  }
  if (
    error.code === ERROR_CODES.MALFORMED ||
    error.code === ERROR_CODES.UNSUPPORTED_VERSION ||
    error.code === ERROR_CODES.INVALID_PAYLOAD
  ) {
    return SESSION_ERROR_CODES.VAULT_CORRUPT;
  }
  if (error.code === ERROR_CODES.NOT_FOUND) {
    return SESSION_ERROR_CODES.VAULT_NOT_FOUND;
  }
  return SESSION_ERROR_CODES.VAULT_CORRUPT;
}

function createVaultSession(options = {}) {
  if (!options.userDataPath) {
    throw new Error("VaultSession requires userDataPath.");
  }

  const userDataPath = options.userDataPath;
  const legacyPath = path.join(userDataPath, LEGACY_FILENAME);
  const encryptedPath = path.join(userDataPath, ENCRYPTED_FILENAME);

  let unlocked = false;

  function legacyVaultPresent() {
    if (!fs.existsSync(legacyPath)) return false;
    try {
      const raw = fs.readFileSync(legacyPath, "utf8");
      const parsed = JSON.parse(raw || "{}");
      return isLegacyPlaintextVault(parsed);
    } catch (error) {
      return false;
    }
  }

  function encryptedVaultPresent() {
    return fs.existsSync(encryptedPath);
  }

  function inspectEncryptedVault() {
    if (!encryptedVaultPresent()) {
      return { present: false, valid: false, errorCode: null };
    }

    try {
      readEncryptedVaultFile(encryptedPath);
      return { present: true, valid: true, errorCode: null };
    } catch (error) {
      return { present: true, valid: false, errorCode: mapCryptoError(error) };
    }
  }

  function computeMode() {
    const legacyPresent = legacyVaultPresent();
    const encrypted = inspectEncryptedVault();

    if (encrypted.present && !encrypted.valid) {
      return {
        mode: VAULT_MODES.ENCRYPTED_ERROR,
        unlocked: false,
        encryptedVaultPresent: true,
        legacyVaultPresent: legacyPresent,
        errorCode: encrypted.errorCode || SESSION_ERROR_CODES.VAULT_CORRUPT
      };
    }

    if (encrypted.valid && legacyPresent) {
      return {
        mode: VAULT_MODES.LEGACY_WITH_VAULT,
        unlocked,
        encryptedVaultPresent: true,
        legacyVaultPresent: true,
        errorCode: null
      };
    }

    if (encrypted.valid) {
      return {
        mode: unlocked ? VAULT_MODES.ENCRYPTED_UNLOCKED : VAULT_MODES.ENCRYPTED_LOCKED,
        unlocked,
        encryptedVaultPresent: true,
        legacyVaultPresent: false,
        errorCode: null
      };
    }

    if (legacyPresent) {
      return {
        mode: VAULT_MODES.LEGACY,
        unlocked: false,
        encryptedVaultPresent: false,
        legacyVaultPresent: true,
        errorCode: null
      };
    }

    return {
      mode: VAULT_MODES.SETUP_REQUIRED,
      unlocked: false,
      encryptedVaultPresent: false,
      legacyVaultPresent: false,
      errorCode: null
    };
  }

  function getStatus() {
    return { success: true, data: computeMode() };
  }

  function fail(code, message) {
    return { success: false, error: message, code };
  }

  async function setup(masterPassword, confirmPassword) {
    const password = normalizePasswordInput(masterPassword);
    const confirm = normalizePasswordInput(confirmPassword);

    if (!password.length) {
      return fail(SESSION_ERROR_CODES.PASSWORD_REQUIRED, "Master password is required.");
    }
    if (password !== confirm) {
      return fail(SESSION_ERROR_CODES.PASSWORD_MISMATCH, "Master password confirmation does not match.");
    }

    const encrypted = inspectEncryptedVault();
    if (encrypted.present) {
      return fail(
        SESSION_ERROR_CODES.SETUP_ALREADY_COMPLETE,
        "Encrypted vault is already set up."
      );
    }

    try {
      const envelope = await encryptVaultPayload(emptyVaultPayload(), password);
      writeEncryptedVaultAtomic(encryptedPath, envelope);
      unlocked = true;
      return getStatus();
    } catch (error) {
      const code = mapCryptoError(error);
      return fail(code, error.message || "Vault setup failed.");
    }
  }

  async function unlock(masterPassword) {
    const password = normalizePasswordInput(masterPassword);

    if (!password.length) {
      return fail(SESSION_ERROR_CODES.PASSWORD_REQUIRED, "Master password is required.");
    }

    if (!encryptedVaultPresent()) {
      return fail(SESSION_ERROR_CODES.VAULT_NOT_FOUND, "Encrypted vault was not found.");
    }

    let envelope;
    try {
      envelope = readEncryptedVaultFile(encryptedPath);
    } catch (error) {
      unlocked = false;
      const code = mapCryptoError(error);
      return fail(code, "Encrypted vault is corrupt or unsupported.");
    }

    try {
      await decryptVaultPayload(envelope, password);
      unlocked = true;
      return getStatus();
    } catch (error) {
      unlocked = false;
      const code = mapCryptoError(error);
      if (code === SESSION_ERROR_CODES.WRONG_PASSWORD) {
        return fail(code, "Incorrect master password.");
      }
      return fail(code, "Encrypted vault is corrupt or unsupported.");
    }
  }

  function lock() {
    unlocked = false;
    return getStatus();
  }

  function isUnlocked() {
    return unlocked;
  }

  function getPaths() {
    return { legacyPath, encryptedPath, userDataPath };
  }

  function _resetSessionForTests() {
    unlocked = false;
  }

  return {
    SESSION_ERROR_CODES,
    VAULT_MODES,
    LEGACY_FILENAME,
    ENCRYPTED_FILENAME,
    getStatus,
    setup,
    unlock,
    lock,
    isUnlocked,
    getPaths,
    _resetSessionForTests
  };
}

module.exports = {
  SESSION_ERROR_CODES,
  VAULT_MODES,
  LEGACY_FILENAME,
  ENCRYPTED_FILENAME,
  createVaultSession
};
