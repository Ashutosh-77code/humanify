// content.js
// Runs inside the web page. It reads the selection, asks background.js to
// get the rewrite from the AI, swaps the text, and shows the badge and toasts.

(() => {
  // If this file gets injected twice, don't register everything twice.
  if (window.__humanifyLoaded) return;
  window.__humanifyLoaded = true;

  // =============================================================
  // SETTINGS
  // (The AI model, temperature and prompt live in background.js)
  // =============================================================
  const MAX_CHARS = 4000; // longer selections are truncated

  let busy = false; // true while a rewrite is in progress
  let ui = null;    // our toast/badge container (created on first use)

  // =============================================================
  // 1. LISTEN FOR THE MESSAGE FROM background.js
  // =============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === "rewrite") {
      sendResponse({ ok: true }); // confirm receipt right away
      handleRewrite(message.text);
    }
  });

  // =============================================================
  // 2. MAIN FLOW
  // =============================================================
  async function handleRewrite(fallbackText) {
    if (busy) {
      showToast("Still working on the last rewrite...", "info");
      return;
    }

    // Remember exactly what is selected and where, BEFORE we wait for the API.
    const target = captureSelection();
    const original = (target && target.text) || "";

    if (!target) {
      showToast(
        fallbackText && fallbackText.trim()
          ? "Couldn't find the selected text. Try selecting it again."
          : "Select some text first, then try again.",
        "error"
      );
      return;
    }
    if (!original.trim()) {
      showToast("Select some text first, then try again.", "error");
      return;
    }

    // Very long text: rewrite the first MAX_CHARS characters (cut at a space)
    // and keep the rest of the selection unchanged so nothing is lost.
    let head = original;
    let tail = "";
    if (original.length > MAX_CHARS) {
      let cut = original.lastIndexOf(" ", MAX_CHARS);
      if (cut < MAX_CHARS * 0.5) cut = MAX_CHARS;
      head = original.slice(0, cut);
      tail = original.slice(cut);
    }
    const wasTruncated = tail.length > 0;

    // Keep the selection's leading/trailing whitespace so spacing stays intact.
    const leading = head.match(/^\s*/)[0];
    const trailing = wasTruncated ? "" : head.match(/\s*$/)[0];

    // Loading state: wait cursor + floating badge.
    busy = true;
    const previousCursor = document.body ? document.body.style.cursor : "";
    if (document.body) document.body.style.cursor = "wait";
    showBadge(target);

    try {
      const rewritten = await requestRewrite(head.trim());
      applyRewrite(target, leading + rewritten + trailing + tail);

      if (wasTruncated) {
        showToast(
          "✅ Humanified! Only the first " + MAX_CHARS + " characters were rewritten.",
          "warn",
          5000
        );
      } else {
        showToast("✅ Humanified!", "success", 2500);
      }
    } catch (error) {
      // Nothing on the page was changed, so just put the selection back.
      restoreSelection(target);
      if (error.noKey) {
        showToast("Please set your API key in the extension popup.", "error", 4000);
      } else {
        showToast("❌ Rewrite failed: " + error.message, "error", 5000);
      }
    } finally {
      busy = false;
      if (document.body) document.body.style.cursor = previousCursor;
      hideBadge();
    }
  }

  // =============================================================
  // 3. ASK background.js TO GET THE REWRITE
  // =============================================================
  function requestRewrite(text) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "callModel", text: text }, (response) => {
        // If the extension was reloaded, this page is cut off from it.
        if (chrome.runtime.lastError) {
          reject(new Error("Humanify was reloaded. Refresh this page and try again."));
          return;
        }
        if (!response) {
          reject(new Error("No response from the extension."));
        } else if (response.ok) {
          resolve(response.text);
        } else {
          const error = new Error(response.error);
          error.noKey = !!response.noKey;
          reject(error);
        }
      });
    });
  }

  // =============================================================
  // 4. FIND, RESTORE AND REPLACE THE SELECTION
  // =============================================================

  // Work out what kind of selection this is and remember it.
  function captureSelection() {
    // Case A: text selected inside a <textarea> or <input>.
    const active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (typeof start === "number" && typeof end === "number" && start !== end) {
        return {
          kind: "field",
          el: active,
          start: start,
          end: end,
          text: active.value.slice(start, end)
        };
      }
    }

    // Case B/C: a normal selection on the page.
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const range = selection.getRangeAt(0).cloneRange();
      const node = range.commonAncestorContainer;
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      const editable = !!(element && element.isContentEditable);
      return {
        kind: editable ? "editable" : "page",
        range: range,
        text: selection.toString()
      };
    }

    return null;
  }

  // Put the user's selection back (used after errors).
  function restoreSelection(target) {
    try {
      if (target.kind === "field") {
        target.el.focus();
        target.el.setSelectionRange(target.start, target.end);
      } else {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(target.range);
      }
    } catch (error) {
      // Not critical, ignore.
    }
  }

  // Swap the selected text for the rewritten text.
  function applyRewrite(target, newText) {
    // <textarea> / <input>
    if (target.kind === "field") {
      const el = target.el;
      if (el.value.slice(target.start, target.end) !== target.text) {
        throw new Error("The text changed while rewriting, so nothing was replaced.");
      }
      el.focus();
      el.setRangeText(newText, target.start, target.end, "select");
      // Tell the page (and frameworks like React) that the value changed.
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // contentEditable (rich text editors, Gmail compose, etc.)
    if (target.kind === "editable") {
      const node = target.range.commonAncestorContainer;
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      const host = element && element.closest("[contenteditable]");
      if (host) host.focus({ preventScroll: true });

      restoreSelection(target);
      // execCommand keeps the editor's undo history working.
      if (document.execCommand("insertText", false, newText)) return;
    }

    // Plain page text (or the fallback if execCommand failed).
    replaceRange(target.range, newText);
  }

  // Delete the range and insert a text node in its place, then highlight it.
  function replaceRange(range, newText) {
    range.deleteContents();
    const textNode = document.createTextNode(newText);
    range.insertNode(textNode);

    const selection = window.getSelection();
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(textNode);
    selection.addRange(newRange);
  }

  // =============================================================
  // 5. UI: TOASTS AND THE LOADING BADGE
  // Everything lives in a Shadow DOM so the page's CSS can't break it.
  // =============================================================
  function getUI() {
    if (ui && ui.host.isConnected) return ui;

    const host = document.createElement("div");
    host.id = "humanify-host";
    host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;";

    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .toast, .badge {
        position: fixed;
        font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        color: #ffffff;
        padding: 10px 14px;
        border-radius: 10px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
        max-width: min(360px, calc(100vw - 32px));
        pointer-events: none;
      }
      .toast {
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        background: #1f2937;
        animation: pop 0.2s ease-out;
      }
      .toast.success { background: #047857; }
      .toast.error   { background: #b91c1c; }
      .toast.warn    { background: #b45309; }
      .badge {
        background: #6d28d9;
        white-space: nowrap;
      }
      @keyframes pop {
        from { opacity: 0; transform: translate(-50%, 8px); }
        to   { opacity: 1; transform: translate(-50%, 0); }
      }
    `;
    root.appendChild(style);

    (document.body || document.documentElement).appendChild(host);
    ui = { host: host, root: root, toastEl: null, toastTimer: null, badgeEl: null };
    return ui;
  }

  // Show a message at the bottom of the screen, then remove it.
  function showToast(message, type, duration) {
    const u = getUI();
    if (u.toastEl) u.toastEl.remove();
    clearTimeout(u.toastTimer);

    const toast = document.createElement("div");
    toast.className = "toast " + (type || "info");
    toast.textContent = message; // textContent = safe, no HTML injection
    toast.setAttribute("role", "status");
    u.root.appendChild(toast);
    u.toastEl = toast;

    u.toastTimer = setTimeout(() => {
      toast.remove();
      if (u.toastEl === toast) u.toastEl = null;
    }, duration || 4000);
  }

  // Small floating badge placed just below the selection.
  function showBadge(target) {
    const u = getUI();
    hideBadge();

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = "Humanifying... 🤖→😎";
    u.root.appendChild(badge);
    u.badgeEl = badge;

    // Position it under the selection (or above it if there's no room below).
    const rect =
      target.kind === "field"
        ? target.el.getBoundingClientRect()
        : target.range.getBoundingClientRect();

    let top = rect.bottom + 8;
    let left = rect.left;
    if (top > window.innerHeight - 56) top = rect.top - 48;
    top = Math.max(8, top);
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - 220));

    badge.style.top = top + "px";
    badge.style.left = left + "px";
  }

  function hideBadge() {
    if (ui && ui.badgeEl) {
      ui.badgeEl.remove();
      ui.badgeEl = null;
    }
  }
})();
