/**
 * MBrowser Autofill — guest-page injection script builder (Phase 1E-C.1)
 * Produces a self-contained IIFE for window.__MB_AF (detection only).
 */

const AutofillInject = (function () {
  function buildScript() {
    return `(() => {
      if (window.__MB_AF && window.__MB_AF.__ready) {
        if (typeof window.__MB_AF.cleanup === "function") window.__MB_AF.cleanup();
      }

      const DEBOUNCE_MS = 300;

      const state = {
        __ready: true,
        lastSignature: "",
        observer: null,
        debounceTimer: null,

        cleanup() {
          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
          }
          if (this.observer) {
            try { this.observer.disconnect(); } catch (e) { /* ignore */ }
            this.observer = null;
          }
          this.lastSignature = "";
        },

        isVisible(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        },

        findPasswordInputs(root) {
          const scope = root || document;
          const nodes = Array.from(scope.querySelectorAll('input[type="password"]'));
          const auto = Array.from(scope.querySelectorAll('input[autocomplete="current-password"]'));
          const merged = nodes.concat(auto.filter((el) => nodes.indexOf(el) < 0));
          return merged.filter((el) => this.isVisible(el));
        },

        scoreUsername(input) {
          const hint = (
            (input.name || "") + " " +
            (input.id || "") + " " +
            (input.autocomplete || "") + " " +
            (input.placeholder || "")
          ).toLowerCase();
          if (input.type === "password" || input.type === "hidden") return -100;
          if (/pass|pwd|token|csrf|captcha|search|otp|code|secret/.test(hint)) return -50;
          let score = 0;
          if (input.type === "email") score += 8;
          if (/user|email|login|account|identifier|phone|signin|sign-in/.test(hint)) score += 6;
          const ac = (input.autocomplete || "").toLowerCase();
          if (ac === "username") score += 10;
          if (ac === "email") score += 8;
          if (this.isVisible(input)) score += 2;
          return score;
        },

        findUsernameField(passwordInput) {
          const form = passwordInput.form || passwordInput.closest("form");
          const scope = form || document;
          const types = ["text", "email", "tel", "url", "search", ""];
          const candidates = Array.from(scope.querySelectorAll("input")).filter((input) => {
            if (input === passwordInput) return false;
            const type = (input.type || "text").toLowerCase();
            return types.includes(type);
          });
          candidates.sort((a, b) => this.scoreUsername(b) - this.scoreUsername(a));
          const best = candidates[0];
          if (!best || this.scoreUsername(best) < 1) return null;
          return best;
        },

        fieldMeta(input, role) {
          const rect = input.getBoundingClientRect();
          return {
            role: role || (input.type === "password" ? "password" : "username"),
            tagName: input.tagName,
            type: input.type || "text",
            autocomplete: input.autocomplete || "",
            name: input.name || "",
            id: input.id || "",
            visible: this.isVisible(input),
            rect: {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          };
        },

        detectForm() {
          const protocol = String(location.protocol || "").toLowerCase();
          if (protocol !== "http:" && protocol !== "https:") {
            return {
              url: location.href,
              origin: "",
              hasPasswordField: false,
              hasUsernameField: false,
              hasLoginForm: false,
              fields: []
            };
          }

          const passwords = this.findPasswordInputs(document);
          const hasPasswordField = passwords.length > 0;
          const fields = [];
          let usernameInput = null;

          if (passwords.length) {
            const passwordInput = passwords[0];
            fields.push(this.fieldMeta(passwordInput, "password"));
            usernameInput = this.findUsernameField(passwordInput);
            if (usernameInput) {
              fields.push(this.fieldMeta(usernameInput, "username"));
            }
          }

          const hasUsernameField = !!usernameInput;
          const hasLoginForm = hasPasswordField && hasUsernameField;

          const origin = (location.origin && location.origin !== "null") ? location.origin : "";

          return {
            url: location.href,
            origin: origin,
            hasPasswordField: hasPasswordField,
            hasUsernameField: hasUsernameField,
            hasLoginForm: hasLoginForm,
            fields: fields
          };
        },

        buildSignature(result) {
          if (!result || !result.hasLoginForm) return "";
          const parts = [result.origin || result.url || ""];
          (result.fields || []).forEach((field) => {
            parts.push(
              (field.role || "") + "|" +
              (field.type || "") + "|" +
              (field.name || "") + "|" +
              (field.id || "") + "|" +
              (field.autocomplete || "")
            );
          });
          return parts.join("::");
        },

        scheduleScan() {
          if (this.debounceTimer) clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.scan(false);
          }, DEBOUNCE_MS);
        },

        scan(initial) {
          const result = this.detectForm();
          const signature = this.buildSignature(result);
          const changed = signature !== this.lastSignature;
          result.changed = changed;
          result.initial = !!initial;
          if (signature) this.lastSignature = signature;
          else this.lastSignature = "";

          if (changed && result.hasLoginForm) {
            try {
              if (
                window.electronAPI &&
                typeof window.electronAPI.reportAutofillFormDetected === "function"
              ) {
                window.electronAPI.reportAutofillFormDetected({
                  origin: result.origin,
                  url: result.url,
                  hasLoginForm: result.hasLoginForm,
                  hasPasswordField: result.hasPasswordField,
                  hasUsernameField: result.hasUsernameField,
                  fields: result.fields
                });
              }
            } catch (e) { /* ignore */ }
          }

          return result;
        },

        getStatus() {
          return this.scan(false);
        },

        startObserver() {
          if (this.observer || !document.body) return;
          this.observer = new MutationObserver(() => {
            this.scheduleScan();
          });
          this.observer.observe(document.body, { childList: true, subtree: true });
        },

        init() {
          const initial = this.scan(true);
          if (document.body) this.startObserver();
          else document.addEventListener("DOMContentLoaded", () => this.startObserver(), { once: true });
          return initial;
        }
      };

      window.__MB_AF = state;
      return state.init();
    })()`;
  }

  return { buildScript };
})();

window.AutofillInject = AutofillInject;
