/**
 * MBrowser password vault access — scoped match/retrieve (Phase 1E-D.4).
 * Main-process only. Never returns the full vault across the access boundary.
 */

const {
  isMigrationComplete
} = require("./VaultMigration");
const { getAuthoritativePasswordEntries } = require("./VaultAuthority");

const ACCESS_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  VAULT_LOCKED: "VAULT_LOCKED",
  VAULT_CORRUPT: "VAULT_CORRUPT",
  VAULT_NOT_FOUND: "VAULT_NOT_FOUND",
  CREDENTIAL_NOT_FOUND: "CREDENTIAL_NOT_FOUND",
  ORIGIN_MISMATCH: "ORIGIN_MISMATCH",
  ENCRYPTION_NOT_READY: "ENCRYPTION_NOT_READY"
});

const LEGACY_FILENAME = "passwords.json";

function fail(code, message) {
  return { success: false, error: message, code };
}

function isEligibleHttpUrl(url) {
  try {
    const protocol = new URL(String(url || "")).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch (error) {
    return false;
  }
}

function originFromUrl(url) {
  if (!isEligibleHttpUrl(url)) return "";
  try {
    const parsed = new URL(url);
    if (parsed.origin && parsed.origin !== "null") return parsed.origin;
    return "";
  } catch (error) {
    return "";
  }
}

function normalizePageOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "null") return "";
  if (/^(file|about|chrome|edge|data|blob|javascript):/i.test(raw)) return "";
  return originFromUrl(raw) || (isEligibleHttpUrl(raw) ? raw : "");
}

function getAuthoritativeEntries(userDataPath, getSession, isMigrationCompleteFn) {
  return getAuthoritativePasswordEntries(userDataPath, getSession, isMigrationCompleteFn);
}

function createVaultAccess(options = {}) {
  if (!options.userDataPath) {
    throw new Error("VaultAccess requires userDataPath.");
  }
  if (typeof options.getSession !== "function") {
    throw new Error("VaultAccess requires getSession.");
  }

  const userDataPath = options.userDataPath;
  const getSession = options.getSession;
  const isMigrationCompleteFn = options.isMigrationComplete || isMigrationComplete;

  function matchCredentials(origin) {
    const pageOrigin = normalizePageOrigin(origin);
    if (!pageOrigin) {
      return fail(ACCESS_ERROR_CODES.INVALID_REQUEST, "A valid page origin is required.");
    }

    const auth = getAuthoritativeEntries(userDataPath, getSession, isMigrationCompleteFn);
    if (!auth.success) return auth;

    const matches = auth.entries
      .filter((entry) => normalizePageOrigin(entry.origin || entry.url) === pageOrigin)
      .map((entry) => ({
        id: String(entry.id || ""),
        username: String(entry.username || "")
      }))
      .filter((entry) => entry.id);

    return { success: true, data: { matches } };
  }

  function retrieveCredentialForFill(id, origin) {
    const credentialId = String(id || "").trim();
    if (!credentialId) {
      return fail(ACCESS_ERROR_CODES.INVALID_REQUEST, "Credential id is required.");
    }

    const pageOrigin = normalizePageOrigin(origin);
    if (!pageOrigin) {
      return fail(ACCESS_ERROR_CODES.INVALID_REQUEST, "A valid page origin is required.");
    }

    const auth = getAuthoritativeEntries(userDataPath, getSession, isMigrationCompleteFn);
    if (!auth.success) return auth;

    const entry = auth.entries.find((item) => String(item.id) === credentialId);
    if (!entry) {
      return fail(ACCESS_ERROR_CODES.CREDENTIAL_NOT_FOUND, "Credential was not found.");
    }

    const entryOrigin = normalizePageOrigin(entry.origin || entry.url);
    if (!entryOrigin || entryOrigin !== pageOrigin) {
      return fail(
        ACCESS_ERROR_CODES.ORIGIN_MISMATCH,
        "Credential does not match the requested page origin."
      );
    }

    const result = {
      username: String(entry.username || ""),
      password: String(entry.password || "")
    };

    return { success: true, data: result };
  }

  return {
    ACCESS_ERROR_CODES,
    normalizePageOrigin,
    getAuthoritativeEntries: () =>
      getAuthoritativeEntries(userDataPath, getSession, isMigrationCompleteFn),
    matchCredentials,
    retrieveCredentialForFill
  };
}

module.exports = {
  ACCESS_ERROR_CODES,
  LEGACY_FILENAME,
  normalizePageOrigin,
  createVaultAccess
};
