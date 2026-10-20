// background.js
// The service worker. It has two jobs:
//   1. Own the right-click menu and hand the selected text to content.js.
//   2. Talk to the AI service (Gemini, Groq or OpenAI) on content.js's behalf.
//      Doing the network call here avoids browser CORS limits on web pages
//      and keeps your API key out of the page itself.

const MENU_ID = "humanify-rewrite";

// ---------------------------------------------------------------
// 1. Create the context menu item when the extension is installed
//    or updated. removeAll() first so we never get a "duplicate id"
//    error after an update.
// ---------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "✨ Make it Human",
      contexts: ["selection"] // only show the item when text is selected
    });
  });
});

// ---------------------------------------------------------------
// 2. When the menu item is clicked, send the text to the page.
// ---------------------------------------------------------------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab || tab.id === undefined) return;
  sendRewriteRequest(tab.id, info);
});

async function sendRewriteRequest(tabId, info) {
  const message = { action: "rewrite", text: info.selectionText || "" };

  // Talk only to the frame the user right-clicked in (matters for iframes).
  const frameId = info.frameId || 0;

  try {
    // Try the normal path first: the content script is already loaded.
    await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch (firstError) {
    // No content script yet (first use on this page). Inject it, then retry.
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tabId, message, { frameId });
    } catch (secondError) {
      // Chrome refuses to run extensions on some pages (chrome:// pages,
      // the Web Store, some PDFs, file:// without permission). There is no
      // page script to show a toast, so we flag it on the toolbar icon.
      showPageError(
        "Humanify can't run on this page. Try a normal website or a text editor page."
      );
      console.warn("Humanify: could not reach this page.", secondError);
    }
  }
}

// Show a red "!" on the toolbar icon for 5 seconds, with the reason
// as the hover tooltip.
function showPageError(reason) {
  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
  chrome.action.setTitle({ title: "Humanify: " + reason });

  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Humanify" });
  }, 5000);
}

// ===============================================================
// 3. AI SETTINGS (edit these to customize Humanify)
// ===============================================================
const TEMPERATURE = 1.0;          // higher = more playful, lower = more careful
const MAX_TOKENS = 1500;          // max length of the rewritten text
const REQUEST_TIMEOUT_MS = 60000; // give up after 60 seconds

// Which service is used is detected from the start of your API key:
//   AIza...  -> Google Gemini (free)
//   gsk_...  -> Groq (free)
//   sk-...   -> OpenAI (paid)
// Each service has a list of models. Humanify tries them in order and moves
// to the next one if a model is retired or your account can't use it.
// "extra" is added to the request body, "maxTokens" overrides MAX_TOKENS.
const PROVIDERS = {
  gemini: {
    name: "Gemini",
    models: [
      { id: "gemini-2.5-flash-lite" },
      { id: "gemini-2.5-flash" },
      { id: "gemini-flash-lite-latest" }
    ]
  },
  groq: {
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    models: [
      { id: "llama-3.3-70b-versatile" },
      // A "reasoning" model: low effort keeps it fast, and it needs more tokens.
      { id: "openai/gpt-oss-120b", extra: { reasoning_effort: "low" }, maxTokens: 4000 },
      { id: "llama-3.1-8b-instant" }
    ]
  },
  openai: {
    name: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    models: [{ id: "gpt-4o-mini" }]
  }
};

// The instructions we give the model. Rule 4 changes with the "Fun level"
// you pick in the popup. Edit the text below to change the style.
const FUN_RULES = {
  subtle:
    "4. Add ONE tasteful touch of fun: a light metaphor, a witty aside, or a relatable comparison — but never at the expense of clarity or the original argument.",
  funny:
    "4. Make it genuinely funny. Put at least one real joke, witty aside, or playful comparison in every paragraph. Write like a smart, slightly sarcastic friend explaining this over coffee: use contractions, an occasional sentence fragment, and talk to the reader directly now and then. Aim the jokes at the subject, not at the reader. Never change a fact or invent one for a punchline.",
  max:
    "4. Go all in on comedy. Every paragraph gets a joke, and the funniest paragraphs get two. Use deadpan understatement, absurd-but-accurate comparisons, mock-dramatic asides, and the odd running gag. Keep a casual voice with contractions and short punchy fragments. Stay accurate: never change a fact or invent one for a punchline."
};

function buildSystemPrompt(level) {
  const rule4 = FUN_RULES[level] || FUN_RULES.funny;
  return `You are a writing editor who removes AI-generated writing patterns and makes text sound natural, human, and genuinely fun to read.
RULES:

1. Remove ALL AI writing tells: inflated vocabulary (delve, leverage, pivotal, tapestry, testament, underscore, showcase, vibrant, crucial, foster, garner, interplay, intricate), em-dash overuse, rule-of-three lists, "not only...but also", "it's not just about...it's", generic positive conclusions, filler phrases ("it's worth noting", "in today's rapidly evolving landscape"), sycophantic openers ("Great question!"), and vague attributions.
2. Use plain copulas: say "is/are/has" instead of "serves as/stands as/boasts/features".
3. Vary sentence length: mix short punchy sentences with occasional longer ones. Break uniformity.
` + rule4 + `\n` + `5. Preserve the original meaning, key facts, and argument structure. Do NOT add new claims.
6. Output ONLY the rewritten text. No preamble, no "Here's the rewritten version", no explanations.`;
}

// ===============================================================
// 4. LISTEN FOR REQUESTS FROM content.js
// ===============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === "callModel") {
    callModel(message.text)
      .then((text) => sendResponse({ ok: true, text: text }))
      .catch((error) =>
        sendResponse({ ok: false, error: error.message, noKey: !!error.noKey })
      );
    return true; // keep the channel open for the async reply
  }
});

// Work out which service a key belongs to.
function detectProvider(key) {
  if (key.startsWith("AIza")) return "gemini";
  if (key.startsWith("gsk_")) return "groq";
  if (key.startsWith("sk-")) return "openai";
  return null;
}

// Read the saved key ("openai_api_key" is the old name from version 1).
async function getApiKey() {
  const stored = await chrome.storage.local.get(["api_key", "openai_api_key"]);
  return (stored.api_key || stored.openai_api_key || "").trim();
}

// Build the URL, headers and body for one model of the chosen service.
function buildRequest(provider, apiKey, text, model, systemPrompt) {
  const config = PROVIDERS[provider];
  const maxTokens = model.maxTokens || MAX_TOKENS;

  if (provider === "gemini") {
    return {
      url:
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        model.id +
        ":generateContent",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: text }] }],
        generationConfig: {
          temperature: TEMPERATURE,
          maxOutputTokens: maxTokens + 1000 // headroom in case the model "thinks"
        }
      }
    };
  }

  // Groq and OpenAI use the same request format.
  return {
    url: config.url,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: Object.assign(
      {
        model: model.id,
        temperature: TEMPERATURE,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ]
      },
      model.extra || {}
    )
  };
}

// Pull the rewritten text out of a Gemini response.
function readGemini(data) {
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) {
    const reason = data.promptFeedback && data.promptFeedback.blockReason;
    throw new Error(
      reason ? "Gemini blocked this text (" + reason + ")." : "Gemini returned no result."
    );
  }
  const parts = (candidate.content && candidate.content.parts) || [];
  return parts.map((part) => part.text || "").join("").trim();
}

// Pull the rewritten text out of an OpenAI-style response (Groq, OpenAI).
function readOpenAIStyle(data) {
  const choice = data.choices && data.choices[0];
  return choice && choice.message && choice.message.content
    ? choice.message.content.trim()
    : "";
}

// Send the text to the AI and return the rewritten version.
async function callModel(text) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    const error = new Error("No API key saved.");
    error.noKey = true;
    throw error;
  }

  const provider = detectProvider(apiKey);
  if (!provider) {
    throw new Error(
      "Unrecognized key. Gemini keys start with AIza, Groq keys with gsk_, OpenAI keys with sk-."
    );
  }

  // Read the fun level chosen in the popup (default: funny).
  const stored = await chrome.storage.local.get("fun_level");
  const systemPrompt = buildSystemPrompt(stored.fun_level);

  // Try each model in order. We only move on to the next model when the
  // problem is the model itself (retired, or your account can't use it).
  const models = PROVIDERS[provider].models;
  let lastError;
  for (const model of models) {
    try {
      return await requestOnce(provider, model, apiKey, text, systemPrompt);
    } catch (error) {
      lastError = error;
      if (!error.modelProblem) throw error;
    }
  }
  throw new Error(
    lastError.message + " (tried: " + models.map((m) => m.id).join(", ") + ")"
  );
}

// One request to one model.
async function requestOnce(provider, model, apiKey, text, systemPrompt) {
  const request = buildRequest(provider, apiKey, text, model, systemPrompt);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request timed out. Please try again.");
    }
    throw new Error("Network error. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  // All three services return a JSON error body when something goes wrong.
  if (!response.ok) {
    let detail = "";
    try {
      const errorData = await response.json();
      detail = errorData.error && errorData.error.message;
    } catch (error) {
      detail = "";
    }
    const failure = new Error(
      detail || PROVIDERS[provider].name + " error (HTTP " + response.status + ")"
    );
    // Flag "this model isn't available" errors so callModel can try the next one.
    failure.modelProblem =
      response.status === 404 ||
      /does not exist|do not have access|not found|decommission|deprecated|no longer supported/i.test(
        failure.message
      );
    throw failure;
  }

  const data = await response.json();
  const output = provider === "gemini" ? readGemini(data) : readOpenAIStyle(data);

  if (!output) throw new Error("The AI returned an empty response.");
  return output;
}