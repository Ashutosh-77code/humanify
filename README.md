# Humanify ✨

A Chrome extension that rewrites any text you select so it sounds more human and fun. It works with a free Google Gemini or Groq key, or a paid OpenAI key.

## Install

1. Download or clone this folder.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `humanify` folder (the one containing `manifest.json`).
5. Optional: pin Humanify from the puzzle-piece menu.

The `icons/` folder has simple placeholder icons. Replace `16.png`, `48.png` and `128.png` with your own at any time (keep the same file names).

## Get an API key

Humanify works out which service to use from the start of your key.

| Service | Cost | Key starts with | Get it at |
|---|---|---|---|
| Google Gemini | Free tier, no card | `AIza` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Groq | Free tier | `gsk_` | [console.groq.com/keys](https://console.groq.com/keys) |
| OpenAI | Paid (prepaid credit) | `sk-` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

Then click the Humanify icon, paste the key and press **Save Key**. The key is stored only in your browser (`chrome.storage.local`) and is sent only to the matching service.

## How to use

1. Select some text on a page, in a text box, or in an editor.
2. Right-click and choose **✨ Make it Human**.
3. Wait a moment while the badge shows "Humanifying...". The text is replaced when it's done.

Notes:
- In text boxes and editors (textarea, input, Gmail compose and similar), the replacement is real and you can undo it with `Ctrl+Z`.
- On regular web pages the replacement is visual only. It disappears when you reload.
- Selections over 4000 characters: the first 4000 are rewritten and the rest is left as it was.
- Chrome doesn't allow extensions on `chrome://` pages, the Chrome Web Store, or some PDF viewers. If you right-click there, the toolbar icon shows a red `!`.
- To use it on local `file://` pages, open `chrome://extensions`, click **Details** on Humanify, and turn on **Allow access to file URLs**.

## Cost and privacy

Gemini and Groq have free tiers with daily limits, which is plenty for personal use. If you hit a limit, wait and try again. Free-tier limits and terms change, so check the provider's site. OpenAI charges a fraction of a cent per rewrite.

Your selected text is sent to the service that owns your key, so don't use it on anything confidential. Free tiers may use submitted text to improve their products.

## Customize the fun level

Open `background.js` and edit the settings in section 3:

- **`TEMPERATURE`** (default `0.9`): raise it toward `1.2` for wilder, more playful rewrites, or lower it toward `0.5` for safer, more faithful ones.
- **`SYSTEM_PROMPT`**: the editing instructions sent to the model. Rule 4 controls how much humor gets added.
- **`PROVIDERS`**: the model name used for each service. If a model is retired and you see a "model not found" error, replace the name with a current one from the provider's docs.

Open `content.js` to change `MAX_CHARS`, the longest selection that is rewritten in one go.

After editing any file, go to `chrome://extensions` and click the reload icon on Humanify, then refresh the page you're testing on.

## Files

| File | Job |
|---|---|
| `manifest.json` | Extension settings and permissions |
| `background.js` | Right-click menu, and the call to the AI service |
| `content.js` | Reads and replaces the selected text, shows the badge and toasts |
| `popup.html` / `popup.css` / `popup.js` | The API key popup |
