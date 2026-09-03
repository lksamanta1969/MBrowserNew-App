/**
 * MBrowser password vault migration — main process (Phase 1E-D.3).
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  VaultCryptoError,
  encryptVaultPayload,
  decryptVaultPayload,
  isLegacyPlaintextVault,
  readEncryptedVaultFile,
  writeEncryptedVaultAtomic
} = require("./VaultCrypto");

const LEGACY_FILENAME = "passwords.json";
const ENCRYPTED_FILENAME = "passwords.vault.json";

const MIGRATION_MARKER_FILENAME = "passwords.migration.json";
const MIGRATION_LOCK_FILENAME = "passwords.migration.lock";
const LEGACY_BACKUP_PREFIX = "passwords.json.pre-migration.bak.";

const MIGRATION_STATES = Object.freeze({
  NONE: "none",
  PENDING: "pending",
  COMPLETE: "complete"
});

const MIGRATION_ERROR_CODES = Object.freeze({
  NO_LEGACY_VAULT: "NO_LEGACY_VAULT",
  MASTER_PASSWORD_REQUIRED: "MASTER_PASSWORD_REQUIRED",
  LEGACY_INVALID: "LEGACY_INVALID",
  BACKUP_FAILED: "BACKUP_FAILED",
  ENCRYPTION_FAILED: "ENCRYPTION_FAILED",
  WRITE_FAILED: "WRITE_FAILED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  RETIREMENT_FAILED: "RETIREMENT_FAILED",
  MARKER_FAILED: "MARKER_FAILED",
  ALREADY_MIGRATED: "ALREADY_MIGRATED",
  ENCRYPTED_VAULT_HAS_DATA: "ENCRYPTED_VAULT_HAS_DATA",
  ENCRYPTED_VAULT_REQUIRED: "ENCRYPTED_VAULT_REQUIRED",
  ENCRYPTED_CORRUPT: "ENCRYPTED_CORRUPT",
  WRONG_PASSWORD: "WRONG_PASSWORD",
  PASSWORD_REQUIRED: "PASSWORD_REQUIRED"
});

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function migrationMarkerPath(userDataPath) {
  return path.join(userDataPath, MIGRATION_MARKER_FILENAME);
}

function migrationLockPath(userDataPath) {
  return path.join(userDataPath, MIGRATION_LOCK_FILENAME);
}

function legacyVaultPath(userDataPath) {
  return path.join(userDataPath, LEGACY_FILENAME);
}

function encryptedVaultPath(userDataPath) {
  return path.join(userDataPath, ENCRYPTED_FILENAME);
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function canonicalChecksum(vault) {
  return crypto.createHash("sha256").update(JSON.stringify(vault)).digest("hex");
}

function vaultDataEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readMigrationMarker(userDataPath) {
  const markerPath = migrationMarkerPath(userDataPath);
  if (!fs.existsSync(markerPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function isMigrationComplete(userDataPath) {
  const marker = readMigrationMarker(userDataPath);
  return !!(marker && marker.state === MIGRATION_STATES.COMPLETE);
}

function legacyVaultPresent(userDataPath) {
  const filePath = legacyVaultPath(userDataPath);
  if (!fs.existsSync(filePath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isLegacyPlaintextVault(parsed);
  } catch (error) {
    return false;
  }
}

function readLegacyVault(userDataPath) {
  const filePath = legacyVaultPath(userDataPath);
  if (!fs.existsSync(filePath)) {
    const error = new Error("Legacy password vault was not found.");
    error.code = MIGRATION_ERROR_CODES.NO_LEGACY_VAULT;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const invalid = new Error("Legacy password vault is not valid JSON.");
    invalid.code = MIGRATION_ERROR_CODES.LEGACY_INVALID;
    throw invalid;
  }

  if (!isLegacyPlaintextVault(parsed)) {
    const invalid = new Error("Legacy password vault has an invalid structure.");
    invalid.code = MIGRATION_ERROR_CODES.LEGACY_INVALID;
    throw invalid;
  }

  return deepClone({
    version: parsed.version || 1,
    entries: parsed.entries
  });
}

function legacyEntryCount(userDataPath) {
  if (!legacyVaultPresent(userDataPath)) return 0;
  try {
    return readLegacyVault(userDataPath).entries.length;
  } catch (error) {
    return 0;
  }
}

function inspectEncryptedVault(userDataPath) {
  const filePath = encryptedVaultPath(userDataPath);
  if (!fs.existsSync(filePath)) {
    return { present: false, valid: false, envelope: null };
  }
  try {
    const envelope = readEncryptedVaultFile(filePath);
    return { present: true, valid: true, envelope };
  } catch (error) {
    return { present: true, valid: false, envelope: null };
  }
}

function computeMigrationStatus(userDataPath, session) {
  const marker = readMigrationMarker(userDataPath);
  const migrationComplete = !!(marker && marker.state === MIGRATION_STATES.COMPLETE);
  const legacyPresent = legacyVaultPresent(userDataPath);
  const encrypted = inspectEncryptedVault(userDataPath);
  const unlocked = session ? session.isUnlocked() : false;
  const entryCount = legacyPresent ? legacyEntryCount(userDataPath) : marker && marker.entryCount || 0;

  let migrationState = MIGRATION_STATES.NONE;
  if (migrationComplete) {
    migrationState = MIGRATION_STATES.COMPLETE;
  } else if (legacyPresent && encrypted.valid) {
    migrationState = MIGRATION_STATES.PENDING;
  }

  const canMigrate =
    migrationState === MIGRATION_STATES.PENDING &&
    unlocked &&
    legacyPresent &&
    encrypted.valid;

  return {
    migrationState,
    legacyEntryCount: entryCount,
    canMigrate,
    migrationComplete,
    legacyPresent,
    encryptedPresent: encrypted.present,
    encryptedValid: encrypted.valid
  };
}

function fail(code, message) {
  return { success: false, error: message, code };
}

function writeMigrationMarker(userDataPath, marker) {
  const targetPath = migrationMarkerPath(userDataPath);
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(marker, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpPath, targetPath);
}

function createVerifiedBackup(sourcePath, userDataPath) {
  const backupPath = path.join(userDataPath, `${LEGACY_BACKUP_PREFIX}${backupTimestamp()}`);
  fs.copyFileSync(sourcePath, backupPath);

  const sourceRaw = fs.readFileSync(sourcePath);
  const backupRaw = fs.readFileSync(backupPath);
  if (!sourceRaw.equals(backupRaw)) {
    try {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    } catch (error) {
      /* ignore */
    }
    const error = new Error("Legacy backup verification failed.");
    error.code = MIGRATION_ERROR_CODES.BACKUP_FAILED;
    throw error;
  }

  return backupPath;
}

function retireActiveLegacy(userDataPath) {
  const activePath = legacyVaultPath(userDataPath);
  if (!fs.existsSync(activePath)) return;
  fs.unlinkSync(activePath);
  if (fs.existsSync(activePath)) {
    const error = new Error("Failed to retire the active legacy password vault.");
    error.code = MIGRATION_ERROR_CODES.RETIREMENT_FAILED;
    throw error;
  }
}

function removeEncryptedVaultIfPresent(userDataPath) {
  const filePath = encryptedVaultPath(userDataPath);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function verifyMasterPasswordAgainstEncryptedVault(userDataPath, masterPassword) {
  const encrypted = inspectEncryptedVault(userDataPath);
  if (!encrypted.valid) {
    return fail(MIGRATION_ERROR_CODES.ENCRYPTED_CORRUPT, "Encrypted vault is corrupt or unsupported.");
  }

  try {
    const payload = await decryptVaultPayload(encrypted.envelope, masterPassword);
    return { success: true, payload };
  } catch (error) {
    if (error instanceof VaultCryptoError) {
      return fail(MIGRATION_ERROR_CODES.WRONG_PASSWORD, "Incorrect master password.");
    }
    return fail(MIGRATION_ERROR_CODES.ENCRYPTED_CORRUPT, "Encrypted vault is corrupt or unsupported.");
  }
}

async function migrateVault({ userDataPath, session, masterPassword }) {
  if (isMigrationComplete(userDataPath)) {
    return {
      success: true,
      code: MIGRATION_ERROR_CODES.ALREADY_MIGRATED,
      data: computeMigrationStatus(userDataPath, session)
    };
  }

  const password = typeof masterPassword === "string" ? masterPassword : "";
  if (!password.length) {
    return fail(MIGRATION_ERROR_CODES.PASSWORD_REQUIRED, "Master password is required.");
  }

  if (!session || !session.isUnlocked()) {
    return fail(MIGRATION_ERROR_CODES.MASTER_PASSWORD_REQUIRED, "Unlock the vault before migrating.");
  }

  const legacyPath = legacyVaultPath(userDataPath);
  if (fs.existsSync(legacyPath) && !legacyVaultPresent(userDataPath)) {
    return fail(MIGRATION_ERROR_CODES.LEGACY_INVALID, "Legacy password vault has an invalid structure.");
  }

  if (!legacyVaultPresent(userDataPath)) {
    const encryptedOnly = inspectEncryptedVault(userDataPath);
    if (encryptedOnly.valid) {
      const passwordCheck = await verifyMasterPasswordAgainstEncryptedVault(userDataPath, password);
      if (!passwordCheck.success) {
        return passwordCheck;
      }
      if (
        Array.isArray(passwordCheck.payload.entries) &&
        passwordCheck.payload.entries.length > 0
      ) {
        try {
          writeMigrationMarker(userDataPath, {
            version: 1,
            state: MIGRATION_STATES.COMPLETE,
            completedAt: new Date().toISOString(),
            legacyBackupPath: null,
            entryCount: passwordCheck.payload.entries.length,
            sourceChecksum: canonicalChecksum(passwordCheck.payload)
          });
          session.establishUnlockedSession(password, passwordCheck.payload);
          return {
            success: true,
            data: computeMigrationStatus(userDataPath, session)
          };
        } catch (error) {
          return fail(MIGRATION_ERROR_CODES.MARKER_FAILED, "Migration marker could not be written.");
        }
      }
    }
    return fail(MIGRATION_ERROR_CODES.NO_LEGACY_VAULT, "Legacy password vault was not found.");
  }

  const encrypted = inspectEncryptedVault(userDataPath);
  if (!encrypted.present || !encrypted.valid) {
    return fail(
      MIGRATION_ERROR_CODES.ENCRYPTED_VAULT_REQUIRED,
      "Encrypted vault setup is required before migration."
    );
  }

  const passwordCheck = await verifyMasterPasswordAgainstEncryptedVault(userDataPath, password);
  if (!passwordCheck.success) {
    return passwordCheck;
  }

  let legacySnapshot;
  try {
    legacySnapshot = readLegacyVault(userDataPath);
  } catch (error) {
    return fail(error.code || MIGRATION_ERROR_CODES.LEGACY_INVALID, error.message);
  }

  const currentEncryptedPayload = passwordCheck.payload;
  if (
    Array.isArray(currentEncryptedPayload.entries) &&
    currentEncryptedPayload.entries.length > 0 &&
    !vaultDataEqual(currentEncryptedPayload, legacySnapshot)
  ) {
    return fail(
      MIGRATION_ERROR_CODES.ENCRYPTED_VAULT_HAS_DATA,
      "Encrypted vault already contains data and cannot be overwritten."
    );
  }

  const sourceChecksum = canonicalChecksum(legacySnapshot);
  let backupPath;

  try {
    backupPath = createVerifiedBackup(legacyPath, userDataPath);
  } catch (error) {
    return fail(error.code || MIGRATION_ERROR_CODES.BACKUP_FAILED, error.message);
  }

  let envelope;
  try {
    envelope = await encryptVaultPayload(legacySnapshot, password);
  } catch (error) {
    return fail(MIGRATION_ERROR_CODES.ENCRYPTION_FAILED, "Could not encrypt the legacy password vault.");
  }

  try {
    writeEncryptedVaultAtomic(encryptedVaultPath(userDataPath), envelope);
  } catch (error) {
    return fail(MIGRATION_ERROR_CODES.WRITE_FAILED, "Could not write the encrypted password vault.");
  }

  let verifiedPayload;
  try {
    const writtenEnvelope = readEncryptedVaultFile(encryptedVaultPath(userDataPath));
    verifiedPayload = await decryptVaultPayload(writtenEnvelope, password);
  } catch (error) {
    removeEncryptedVaultIfPresent(userDataPath);
    return fail(MIGRATION_ERROR_CODES.VERIFICATION_FAILED, "Encrypted vault verification failed.");
  }

  if (!vaultDataEqual(legacySnapshot, verifiedPayload)) {
    removeEncryptedVaultIfPresent(userDataPath);
    return fail(MIGRATION_ERROR_CODES.VERIFICATION_FAILED, "Encrypted vault verification failed.");
  }

  try {
    retireActiveLegacy(userDataPath);
  } catch (error) {
    return fail(error.code || MIGRATION_ERROR_CODES.RETIREMENT_FAILED, error.message);
  }

  try {
    writeMigrationMarker(userDataPath, {
      version: 1,
      state: MIGRATION_STATES.COMPLETE,
      completedAt: new Date().toISOString(),
      legacyBackupPath: path.basename(backupPath),
      entryCount: legacySnapshot.entries.length,
      sourceChecksum
    });
  } catch (error) {
    return fail(MIGRATION_ERROR_CODES.MARKER_FAILED, "Migration marker could not be written.");
  }

  session.establishUnlockedSession(password, verifiedPayload);

  return {
    success: true,
    data: computeMigrationStatus(userDataPath, session)
  };
}

module.exports = {
  MIGRATION_MARKER_FILENAME,
  MIGRATION_STATES,
  MIGRATION_ERROR_CODES,
  deepClone,
  migrationMarkerPath,
  isMigrationComplete,
  readMigrationMarker,
  legacyVaultPresent,
  legacyEntryCount,
  computeMigrationStatus,
  migrateVault,
  vaultDataEqual,
  canonicalChecksum,
  legacyVaultPath,
  encryptedVaultPath
};
