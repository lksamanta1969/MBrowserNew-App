/**
 * Main-process password vault authority (Phase 1E security hardening).
 * Single policy for manager CRUD, match, and retrieve boundaries.
 */

const fs = require("fs");

const { isLegacyPlaintextVault } = require("./VaultCrypto");
const {
  isMigrationComplete,
  inspectEncryptedVault,
  legacyVaultPath,
  deepClone
} = require("./VaultMigration");

const AUTHORITY_ERROR_CODES = Object.freeze({
  VAULT_LOCKED: "VAULT_LOCKED",
  VAULT_CORRUPT: "VAULT_CORRUPT",
  VAULT_NOT_FOUND: "VAULT_NOT_FOUND",
  ENCRYPTION_NOT_READY: "ENCRYPTION_NOT_READY"
});

function fail(code, message) {
  return { success: false, error: message, code };
}

function readLegacyEntries(userDataPath) {
  const filePath = legacyVaultPath(userDataPath);
  if (!fs.existsSync(filePath)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isLegacyPlaintextVault(parsed)) return [];
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (error) {
    return [];
  }
}

function readUnlockedSessionEntries(getSession) {
  const session = getSession();
  if (!session || !session.isUnlocked()) {
    return fail(AUTHORITY_ERROR_CODES.VAULT_LOCKED, "Password vault is locked.");
  }

  const data = session.getDecryptedVault();
  if (!data || !Array.isArray(data.entries)) {
    return fail(
      AUTHORITY_ERROR_CODES.ENCRYPTION_NOT_READY,
      "Encrypted password vault is unavailable."
    );
  }

  return { success: true, entries: data.entries };
}

/**
 * Authoritative credential entries for match/retrieve/manager reads.
 * Legacy plaintext is never used when a valid encrypted vault exists and the session is locked.
 */
function getAuthoritativePasswordEntries(userDataPath, getSession, isMigrationCompleteFn) {
  const isCompleteFn = isMigrationCompleteFn || isMigrationComplete;
  const encrypted = inspectEncryptedVault(userDataPath);
  const migrationComplete = isCompleteFn(userDataPath);

  if (migrationComplete) {
    if (!encrypted.present) {
      return fail(AUTHORITY_ERROR_CODES.VAULT_NOT_FOUND, "Encrypted vault was not found.");
    }
    if (!encrypted.valid) {
      return fail(
        AUTHORITY_ERROR_CODES.VAULT_CORRUPT,
        "Encrypted vault is corrupt or unsupported."
      );
    }
    return readUnlockedSessionEntries(getSession);
  }

  if (encrypted.present) {
    if (!encrypted.valid) {
      return fail(
        AUTHORITY_ERROR_CODES.VAULT_CORRUPT,
        "Encrypted vault is corrupt or unsupported."
      );
    }

    const session = getSession();
    if (!session || !session.isUnlocked()) {
      return fail(AUTHORITY_ERROR_CODES.VAULT_LOCKED, "Password vault is locked.");
    }

    const legacyEntries = readLegacyEntries(userDataPath);
    if (legacyEntries.length > 0) {
      return { success: true, entries: legacyEntries };
    }

    return readUnlockedSessionEntries(getSession);
  }

  return { success: true, entries: readLegacyEntries(userDataPath) };
}

function readPasswordVaultPayload(userDataPath, getSession, isMigrationCompleteFn) {
  const encrypted = inspectEncryptedVault(userDataPath);
  const migrationComplete = (isMigrationCompleteFn || isMigrationComplete)(userDataPath);

  if (migrationComplete || encrypted.present) {
    const auth = getAuthoritativePasswordEntries(userDataPath, getSession, isMigrationCompleteFn);
    if (!auth.success) {
      const error = new Error(auth.error || "Password vault is unavailable.");
      error.code = auth.code;
      throw error;
    }
    return deepClone({ version: 1, entries: auth.entries });
  }

  const filePath = legacyVaultPath(userDataPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw || "{}");
    if (!isLegacyPlaintextVault(data) || !Array.isArray(data.entries)) {
      return { version: 1, entries: [] };
    }
    return { version: data.version || 1, entries: data.entries };
  } catch (error) {
    return { version: 1, entries: [] };
  }
}

function encryptedVaultBlocksPlaintextSideEffects(userDataPath) {
  return inspectEncryptedVault(userDataPath).present;
}

module.exports = {
  AUTHORITY_ERROR_CODES,
  getAuthoritativePasswordEntries,
  readPasswordVaultPayload,
  encryptedVaultBlocksPlaintextSideEffects,
  readLegacyEntries
};
