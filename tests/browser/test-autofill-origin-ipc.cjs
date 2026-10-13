const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const root =
    process.env.MBROWSER_TEST_SOURCE || path.join(__dirname, "../../apps/browser");
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        style: { display: "none" },
        classList: {
          add: (v) => classes.add(v),
          remove: (v) => classes.delete(v),
          contains: (v) => classes.has(v)
        },
        querySelectorAll: () => [],
        disabled: true,
        hidden: false,
        innerHTML: "",
        textContent: ""
      });
    }
    return elements.get(id);
  };
  const document = new EventTarget();
  document.getElementById = element;
  const window = { onHomePage: false };
  let matchCalls = 0;
  window.electronAPI = {
    settingsGet: async () => ({
      success: true,
      data: { privacy: { offerToAutofillPasswords: true } }
    }),
    neverSaveGet: async () => ({ success: true, data: { origins: [] } }),
    passwordsMatch: async () => {
      matchCalls++;
      return { success: true, data: { matches: [{ id: "pw_fixture", username: "fixture-user" }] } };
    },
    passwordsRetrieveForFill: async () => ({
      success: true,
      data: { username: "fixture-user", password: "fixture-only" }
    })
  };

  const ctx = vm.createContext({
    window,
    document,
    console,
    URL,
    AbortController,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(root, "BrowserTab.js"), "utf8"), ctx);
  ctx.createTabService = window.createTabService;
  vm.runInContext(fs.readFileSync(path.join(root, "Autofill.js"), "utf8"), ctx);

  class View extends EventTarget {
    constructor() {
      super();
      this.url = "https://fixture.example/login";
      this.isConnected = true;
      this.style = { display: "flex" };
    }
    getURL() {
      return this.url;
    }
    async executeJavaScript() {
      return null;
    }
  }

  const guest = new View();
  elements.set("browser", guest);
  element("home");
  element("afOfferPrompt");
  element("afOfferTitle");
  element("afOfferUser");
  element("afOfferPicker");
  element("afOfferFillBtn");

  return {
    window,
    guest,
    element,
    getMatchCalls: () => matchCalls,
    resetMatchCalls: () => {
      matchCalls = 0;
    }
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function flushAsync(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await tick();
  }
}

function loginFormPayload(overrides = {}) {
  return {
    hasLoginForm: true,
    url: "https://fixture.example/login",
    origin: "https://fixture.example",
    fields: [
      {
        role: "password",
        type: "password",
        name: "password",
        id: "password",
        autocomplete: "current-password"
      },
      {
        role: "username",
        type: "text",
        name: "username",
        id: "username",
        autocomplete: "username"
      }
    ],
    ...overrides
  };
}

async function dispatchFormDetected(view, payload) {
  const event = new Event("ipc-message");
  event.channel = "af:form-detected";
  event.args = [payload];
  view.dispatchEvent(event);
  await flushAsync();
}

test("detectionOriginMatchesGuest accepts matching guest origin", async () => {
  const h = setup();
  const af = h.window.Autofill;
  await af.init();
  await af.activate(h.guest);
  assert.equal(af.detectionOriginMatchesGuest(loginFormPayload()), true);
  af.dispose(h.guest);
});

test("detectionOriginMatchesGuest rejects spoofed origin", async () => {
  const h = setup();
  const af = h.window.Autofill;
  await af.init();
  await af.activate(h.guest);
  assert.equal(
    af.detectionOriginMatchesGuest(
      loginFormPayload({ origin: "https://victim.example" })
    ),
    false
  );
  af.dispose(h.guest);
});

test("detectionOriginMatchesGuest rejects invalid or missing origin", async () => {
  const h = setup();
  const af = h.window.Autofill;
  await af.init();
  await af.activate(h.guest);
  assert.equal(af.detectionOriginMatchesGuest(loginFormPayload({ origin: "", url: "" })), false);
  assert.equal(
    af.detectionOriginMatchesGuest(loginFormPayload({ origin: "javascript:void(0)" })),
    false
  );
  assert.equal(af.detectionOriginMatchesGuest(null), false);
  af.dispose(h.guest);
});

test("matching IPC origin opens offer and performs credential lookup", async () => {
  const h = setup();
  const af = h.window.Autofill;
  await af.init();
  await af.activate(h.guest);
  h.resetMatchCalls();
  await dispatchFormDetected(h.guest, loginFormPayload());
  assert.equal(h.getMatchCalls(), 1);
  assert.equal(h.element("afOfferPrompt").classList.contains("open"), true);
  af.dispose(h.guest);
});

test("spoofed IPC origin is rejected with no credential lookup", async () => {
  const h = setup();
  const af = h.window.Autofill;
  await af.init();
  await af.activate(h.guest);
  h.resetMatchCalls();
  await dispatchFormDetected(
    h.guest,
    loginFormPayload({ origin: "https://victim.example" })
  );
  assert.equal(h.getMatchCalls(), 0);
  assert.equal(h.element("afOfferPrompt").classList.contains("open"), false);
  af.dispose(h.guest);
});

test("invalid IPC origin is rejected with no credential lookup", async () => {
  const h = setup();
  const af = h.window.Autofill;
  await af.init();
  await af.activate(h.guest);
  h.resetMatchCalls();
  await dispatchFormDetected(
    h.guest,
    loginFormPayload({ origin: "https://victim.example", url: "not-a-valid-url" })
  );
  assert.equal(h.getMatchCalls(), 0);
  assert.equal(h.element("afOfferPrompt").classList.contains("open"), false);
  af.dispose(h.guest);
});
