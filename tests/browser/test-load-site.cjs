const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const root = process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const calls = { showHome: 0, navigate: [] };
  const urlInput = { value: "" };

  const document = {
    getElementById(id) {
      if (id === "url") return urlInput;
      return null;
    },
    addEventListener() {}
  };

  const BrowserTab = {
    showHome() {
      calls.showHome += 1;
    },
    navigate(target) {
      calls.navigate.push(target);
    },
    init() {},
    back() {},
    forward() {},
    reload() {},
    create() {},
    close() {},
    activateRelative() {},
    reopenClosed() {},
    active: null
  };

  const Settings = {
    buildSearchUrl(query) {
      return "https://search.test/?q=" + encodeURIComponent(String(query || "").trim());
    },
    init: async () => {}
  };

  const window = { onHomePage: true, Settings, BrowserTab, document };
  const ctx = vm.createContext({ window, document, BrowserTab, Settings, console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(root, "browser.js"), "utf8"), ctx);

  return {
    loadSite: ctx.loadSite,
    calls,
    urlInput
  };
}

function reset(calls, urlInput) {
  calls.showHome = 0;
  calls.navigate.length = 0;
  urlInput.value = "";
}

test("1 mbrowser://home calls BrowserTab.showHome()", () => {
  const h = setup();
  h.urlInput.value = "mbrowser://home";
  h.loadSite();
  assert.equal(h.calls.showHome, 1);
});

test("2 mbrowser://home does not call BrowserTab.navigate()", () => {
  const h = setup();
  h.urlInput.value = "mbrowser://home";
  h.loadSite();
  assert.equal(h.calls.navigate.length, 0);
});

test("3 empty or whitespace input is a no-op", () => {
  const h = setup();
  h.urlInput.value = "";
  h.loadSite();
  assert.equal(h.calls.showHome, 0);
  assert.equal(h.calls.navigate.length, 0);

  reset(h.calls, h.urlInput);
  h.urlInput.value = "   \t  ";
  h.loadSite();
  assert.equal(h.calls.showHome, 0);
  assert.equal(h.calls.navigate.length, 0);
});

test("4 https://example.com navigates unchanged", () => {
  const h = setup();
  h.urlInput.value = "https://example.com";
  h.loadSite();
  assert.equal(h.calls.showHome, 0);
  assert.deepEqual(h.calls.navigate, ["https://example.com"]);
});

test("5 http://example.com navigates unchanged", () => {
  const h = setup();
  h.urlInput.value = "http://example.com";
  h.loadSite();
  assert.equal(h.calls.showHome, 0);
  assert.deepEqual(h.calls.navigate, ["http://example.com"]);
});

test("6 example.com becomes https domain navigation", () => {
  const h = setup();
  h.urlInput.value = "example.com";
  h.loadSite();
  assert.equal(h.calls.showHome, 0);
  assert.deepEqual(h.calls.navigate, ["https://example.com"]);
});

test("7 search-like input uses existing search behaviour", () => {
  const h = setup();
  h.urlInput.value = "mbrowser kittens";
  h.loadSite();
  assert.equal(h.calls.showHome, 0);
  assert.deepEqual(h.calls.navigate, ["https://search.test/?q=mbrowser%20kittens"]);
});

test("mbrowser://HOME does not match internal home URL exactly", () => {
  const h = setup();
  h.urlInput.value = "mbrowser://HOME";
  h.loadSite();
  assert.equal(h.calls.showHome, 0);
  assert.equal(h.calls.navigate.length, 1);
});
