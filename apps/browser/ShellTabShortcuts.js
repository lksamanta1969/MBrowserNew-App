/* Shared shell tab shortcut policy (host + guest forward validation). */
(function () {
    const ACTIONS = new Set(["new-tab", "close-tab", "next-tab", "prev-tab", "reopen-tab"]);
    const SHELL_BROWSER_INPUT_IDS = new Set(["url", "homesearch"]);
    const MANAGER_IDS = [
        "settingsManager",
        "bookmarkManager",
        "historyManager",
        "downloadsManager",
        "passwordManager",
        "ldSavePrompt",
        "ldUpdatePrompt",
        "afOfferPrompt"
    ];

    function isManagerOpen(getElementById) {
        return MANAGER_IDS.some((id) => {
            const el = getElementById(id);
            return !!(el && el.classList.contains("open"));
        });
    }

    function isShellBrowserInput(target) {
        return !!(target && target.tagName === "INPUT" && SHELL_BROWSER_INPUT_IDS.has(target.id));
    }

    function isEditableShellTarget(target) {
        if (!target) return false;
        if (isShellBrowserInput(target)) return false;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
        if (target.isContentEditable) return true;
        return false;
    }

    function shellTabShortcutAllowed(event, getElementById) {
        const lookup = getElementById || ((id) => document.getElementById(id));
        if (isEditableShellTarget(event && event.target)) return false;
        return !isManagerOpen(lookup);
    }

    function shellTabShortcutAllowedForGuestForward(getElementById) {
        const lookup = getElementById || ((id) => document.getElementById(id));
        return !isManagerOpen(lookup);
    }

    function resolveKeyboardShortcutAction(event) {
        if (!event.ctrlKey || event.altKey || event.metaKey) return null;
        const key = event.key;
        if (key === "T" || key === "t") {
            return event.shiftKey ? "reopen-tab" : "new-tab";
        }
        if ((key === "W" || key === "w") && !event.shiftKey) return "close-tab";
        if (key === "Tab" && event.shiftKey) return "prev-tab";
        if (key === "Tab" && !event.shiftKey) return "next-tab";
        return null;
    }

    function isValidAction(action) {
        return ACTIONS.has(action);
    }

    function shouldAcceptGuestShortcut(action, getElementById) {
        return isValidAction(action) && shellTabShortcutAllowedForGuestForward(getElementById);
    }

    window.ShellTabShortcuts = {
        ACTIONS,
        isShellBrowserInput,
        isEditableShellTarget,
        isManagerOpen,
        shellTabShortcutAllowed,
        shellTabShortcutAllowedForGuestForward,
        resolveKeyboardShortcutAction,
        isValidAction,
        shouldAcceptGuestShortcut
    };
})();
