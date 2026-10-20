// popup.js: saves your API key to chrome.storage.local

const form = document.getElementById("keyForm");
const input = document.getElementById("apiKey");
const status = document.getElementById("status");

// Which service a key belongs to, based on how it starts.
function detectProvider(key) {
  if (key.startsWith("AIza")) return "Gemini";
  if (key.startsWith("gsk_")) return "Groq";
  if (key.startsWith("sk-")) return "OpenAI";
  return null;
}

// Update the status line. "kind" is "ok", "error" or "" (neutral).
function setStatus(text, kind) {
  status.textContent = text;
  status.className = "status" + (kind ? " " + kind : "");
}

// When the popup opens, check whether a key is already saved.
// We never put the key back into the input box, so it can't be read over
// your shoulder. We just say whether one exists.
async function showSavedState() {
  try {
    // "openai_api_key" is the old name from version 1 of the extension.
    const stored = await chrome.storage.local.get(["api_key", "openai_api_key"]);
    const key = stored.api_key || stored.openai_api_key;
    if (key) {
      setStatus("✅ Key saved (" + (detectProvider(key) || "unknown") + ")", "ok");
      input.placeholder = "Saved. Paste a new key to replace it";
    } else {
      setStatus("No key set", "");
    }
  } catch (error) {
    setStatus("Couldn't read saved key", "error");
  }
}

// When "Save Key" is clicked (or Enter is pressed), store the key.
form.addEventListener("submit", async (event) => {
  event.preventDefault(); // stop the form reloading the popup

  const value = input.value.trim();

  if (!value) {
    setStatus("Paste your API key first", "error");
    return;
  }

  const provider = detectProvider(value);
  if (!provider) {
    setStatus("Key not recognized. It should start with AIza, gsk_ or sk-", "error");
    return;
  }

  try {
    await chrome.storage.local.set({ api_key: value });
    input.value = "";                                   // clear the box for security
    input.placeholder = "Saved. Paste a new key to replace it";
    setStatus("✅ Key saved (" + provider + ")", "ok");
  } catch (error) {
    setStatus("Couldn't save the key", "error");
  }
});

// ---------------------------------------------------------------
// Fun level: load the saved choice and save any change right away.
// ---------------------------------------------------------------
const funSelect = document.getElementById("funLevel");

async function loadFunLevel() {
  try {
    const stored = await chrome.storage.local.get("fun_level");
    const saved = stored.fun_level;
    const valid = Array.from(funSelect.options).some((o) => o.value === saved);
    funSelect.value = valid ? saved : "funny";
  } catch (error) {
    funSelect.value = "funny";
  }
}

funSelect.addEventListener("change", () => {
  chrome.storage.local.set({ fun_level: funSelect.value });
});

showSavedState();
loadFunLevel();