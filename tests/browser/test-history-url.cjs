const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeHistoryUrl, isRecordableHistoryUrl } = require("../../apps/browser/history-url.cjs");

const EMBEDDED_BASE = "http://localhost:3000/apps/mmail/index.html";

test("A: embedded app ?v=111 and ?v=222 normalize to the same History URL", () => {
  const a = normalizeHistoryUrl(`${EMBEDDED_BASE}?v=111`);
  const b = normalizeHistoryUrl(`${EMBEDDED_BASE}?v=222`);
  assert.equal(a, EMBEDDED_BASE);
  assert.equal(b, EMBEDDED_BASE);
  assert.equal(a, b);
});

test("B: embedded app drops v only and preserves other query parameters", () => {
  const input = "http://localhost:3000/apps/mdrive/index.html?foo=bar&v=999";
  const out = normalizeHistoryUrl(input);
  assert.equal(out, "http://localhost:3000/apps/mdrive/index.html?foo=bar");
});

test("C: external https URL with v remains unchanged", () => {
  const url = "https://example.com/?v=1";
  assert.equal(normalizeHistoryUrl(url), url);
});

test("D: normal http/https URLs remain recordable", () => {
  assert.equal(isRecordableHistoryUrl("https://example.com/"), true);
  assert.equal(isRecordableHistoryUrl("http://example.com/path"), true);
  assert.equal(
    isRecordableHistoryUrl(normalizeHistoryUrl(`${EMBEDDED_BASE}?v=1`)),
    true
  );
});

test("E: about:blank remains non-recordable", () => {
  assert.equal(isRecordableHistoryUrl("about:blank"), false);
});

test("F: chrome:// URL remains non-recordable", () => {
  assert.equal(isRecordableHistoryUrl("chrome://settings/"), false);
});

test("G: data: URL remains non-recordable", () => {
  assert.equal(isRecordableHistoryUrl("data:text/html,hello"), false);
});

test("H: unrelated localhost URLs are not modified", () => {
  const api = "http://localhost:3000/mmail/inbox?v=1";
  assert.equal(normalizeHistoryUrl(api), api);
  const otherPort = "http://localhost:8080/apps/mmail/index.html?v=1";
  assert.equal(normalizeHistoryUrl(otherPort), otherPort);
});

test("I: main.js history record and update-title use the same normalization helper", () => {
  const mainPath = path.join(__dirname, "../../main.js");
  const mainSrc = fs.readFileSync(mainPath, "utf8");
  assert.match(
    mainSrc,
    /require\("\.\/apps\/browser\/history-url\.cjs"\)/
  );
  const recordBlock = mainSrc.slice(
    mainSrc.indexOf('ipcMain.handle("history:record"'),
    mainSrc.indexOf('ipcMain.handle("history:update-title"')
  );
  const updateBlock = mainSrc.slice(
    mainSrc.indexOf('ipcMain.handle("history:update-title"'),
    mainSrc.indexOf('ipcMain.handle("history:delete"')
  );
  assert.match(recordBlock, /normalizeHistoryUrl\(payload && payload\.url\)/);
  assert.match(updateBlock, /normalizeHistoryUrl\(payload && payload\.url\)/);
  assert.doesNotMatch(
    mainSrc.slice(mainSrc.indexOf("/* ===================== History ===================== */")),
    /function normalizeHistoryUrl\(url\)/
  );
});
