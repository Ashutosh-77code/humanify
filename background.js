

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
// Temperature per Fun level (higher = looser and more surprising).
const TEMPERATURES = { subtle: 0.8, funny: 0.9, max: 1.0 };
const DEFAULT_LEVEL = "funny";
// Self-critique: the model writes CANDIDATES versions, scores each for how human
// and quirky it sounds, and only the highest-scoring one is returned.
// It is still ONE request, but the reply is about 3x longer. Set to false to skip it.
const SELF_CRITIQUE = true;
const CANDIDATES = 3;
// Remove any em-dashes and semicolons the model still sneaks in.
const SCRUB_PUNCTUATION = true;
const MAX_TOKENS = 1500;          // max length of ONE rewritten version
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

// The instructions we give the model. Edit the text below to change the style.
const BASE_PROMPT = `You are a human editor with a dry, slightly chaotic sense of humor. Your goal is to rewrite the provided text so it sounds like a real person typed it quickly, completely avoiding the statistical fingerprints of AI (high burstiness, no AI vocabulary). 

Follow these rules strictly for all modes:
1. RHYTHM: Mix very short sentences (2-4 words) with longer, slightly rambling ones. Use sentence fragments. Never write sentences of similar length.
2. VOCABULARY: Never use words like delve, testament, seamless, unlock, landscape, foster, comprehensive, pivotal, or vibrant. Remove all em-dashes (—) and semicolons (;).
3. SPECIFICITY: Do not use generic examples. Use absurdly specific numbers (e.g., "80,373" instead of "a lot") and end sentences on hard consonants.

MODE INSTRUCTIONS:
- SUBTLE: Just fix the rhythm and vocabulary. Make it sound like a smart human wrote it. Do not add jokes.
- FUNNY: Apply the "Misplaced Focus" filter. Describe a tiny, irrelevant detail of the text with intense seriousness. Do not write traditional setup-punchline jokes (no Dad jokes). Make a weird, specific observation.
- TOTAL CHAOS: Make it feel like a human brain getting distracted. Add a sudden parenthetical tangent, shift the tone randomly (e.g., from serious to "anyway, I'm hungry"), and use a strategic run-on sentence. It must feel messy, not random.`;

// The popup stores "subtle", "funny" or "max". This is the name used in the prompt.
const MODE_NAMES = { subtle: "SUBTLE", funny: "FUNNY", max: "TOTAL CHAOS" };

// Added after the prompt: which mode to use, and how to format the reply.
const KEEP_FACTS = "Keep any real names, dates, quotes and figures that the original text already states.";
const SINGLE_FORMAT =
  "Output only the rewritten text, with no preamble and no explanations. " + KEEP_FACTS;
const CRITIQUE_FORMAT =
  "Write " + CANDIDATES + " different rewrites of the user's text in the selected mode. Then score each one " +
  "from 1 to 10 for how human and quirky it sounds (uneven rhythm, specific details, no AI vocabulary). " +
  "Reply in exactly this format and nothing else:\n" +
  Array.from({ length: CANDIDATES }, (_, i) =>
    "===OPTION " + (i + 1) + " | SCORE: <number>===\n<rewrite " + (i + 1) + ">").join("\n") +
  "\n" + KEEP_FACTS;

function buildSystemPrompt(level) {
  const mode = MODE_NAMES[level] || MODE_NAMES[DEFAULT_LEVEL];
  return BASE_PROMPT +
    "\n\nSELECTED MODE: " + mode + ". Follow only that mode's instructions.\n\n" +
    (SELF_CRITIQUE ? CRITIQUE_FORMAT : SINGLE_FORMAT);
}

// From a self-critique reply, return the text of the highest-scoring option.
// If the model ignored the format, the whole reply is used instead.
function pickBestOption(output) {
  const header = /^[ \t]*={3}[ \t]*OPTION[ \t]*(\d+)[^\n=]*?SCORE:[ \t]*([\d.]+)[^\n=]*={3}[ \t]*$/gim;
  const marks = Array.from(output.matchAll(header));
  if (marks.length === 0) return output.trim();

  let best = null;
  marks.forEach((mark, i) => {
    const start = mark.index + mark[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : output.length;
    const text = output.slice(start, end).trim();
    const score = parseFloat(mark[2]) || 0;
    if (text && (best === null || score > best.score)) best = { text: text, score: score };
  });
  return best ? best.text : output.trim();
}

// Replace em-dashes with commas and semicolons with full stops.
function scrubPunctuation(text) {
  return text
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/\s*;\s*(\S)/g, (match, next) => ". " + next.toUpperCase())
    .replace(/\s*;\s*/g, ". ")
    .replace(/,\s*,/g, ",");
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
function buildRequest(provider, apiKey, text, model, systemPrompt, temperature) {
  const config = PROVIDERS[provider];
  // With self-critique the reply holds several versions, so allow more tokens.
  const perVersion = model.maxTokens || MAX_TOKENS;
  const maxTokens = SELF_CRITIQUE ? perVersion * CANDIDATES + 300 : perVersion;

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
          temperature: temperature,
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
        temperature: temperature,
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
  const level = TEMPERATURES[stored.fun_level] !== undefined ? stored.fun_level : DEFAULT_LEVEL;
  const systemPrompt = buildSystemPrompt(level);
  const temperature = TEMPERATURES[level];

  // Try each model in order. We only move on to the next model when the
  // problem is the model itself (retired, or your account can't use it).
  const models = PROVIDERS[provider].models;
  let lastError;
  for (const model of models) {
    try {
      return await requestOnce(provider, model, apiKey, text, systemPrompt, temperature);
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
async function requestOnce(provider, model, apiKey, text, systemPrompt, temperature) {
  const request = buildRequest(provider, apiKey, text, model, systemPrompt, temperature);
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

  const best = SELF_CRITIQUE ? pickBestOption(output) : output.trim();
  return SCRUB_PUNCTUATION ? scrubPunctuation(best) : best;
}
