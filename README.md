# Humanify ✨

So, I built a Chrome extension! It takes whatever text you highlight on a webpage and rewrites it so it sounds a bit more human (and a lot more fun). 

It works out of the box with a free Google Gemini or Groq API key, but you can also plug in a paid OpenAI key if you prefer.

## How to install it

Since it's not on the Chrome Web Store (yet), you have to load it manually. Don't worry, it takes like 30 seconds:

1. Download or clone this repo to your computer.
2. Open Chrome and type `chrome://extensions` in the URL bar.
3. Flip on the **Developer mode** toggle in the top right corner.
4. Click **Load unpacked** and select the `humanify` folder (make sure it's the one with the `manifest.json` inside).
5. *Optional but recommended:* Click the puzzle piece icon in Chrome and pin Humanify so it's always visible.

**A quick note on the icons:** The `icons/` folder just has some basic placeholder images right now. Feel free to swap `16.png`, `48.png`, and `128.png` with your own art (just keep the file names the same so the code doesn't break).

## You'll need an API key

The extension is smart—it looks at the start of your API key to figure out which service to use. 

| Service | Cost | Starts with | Grab a key here |
|---|---|---|---|
| Google Gemini | Free tier (no card needed) | `AIza` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Groq | Free tier | `gsk_` | [console.groq.com/keys](https://console.groq.com/keys) |
| OpenAI | Paid (prepaid) | `sk-` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

Once you have a key, click the Humanify icon in your toolbar, paste the key in, and hit **Save Key**. 

**Privacy note:** Your key is saved completely locally in your browser (`chrome.storage.local`). It gets sent only to the service you're using to generate the text.

## How to use it

1. Highlight some text on a webpage, inside a text box, or in an editor.
2. Right-click and hit **✨ Make it Human**.
3. The extension badge will show "Humanifying..." for a second. Once it's done, your text is replaced.

**Some heads-up:**
* **In text boxes (Gmail, Twitter, etc.):** The replacement is real. If you hate it, just hit `Ctrl+Z` to undo.
* **On normal web pages:** The replacement is just visual. If you reload the page, the original text comes back.
* **Long text:** If you highlight more than 4000 characters, it'll rewrite the first 4000 and leave the rest alone.
* **Where it won't work:** Chrome blocks extensions on `chrome://` pages, the Web Store, and some PDF viewers. If you try to right-click there, the extension icon will show a red `!`.
* **Local files:** Want to use it on a local `file://` page? Go to `chrome://extensions`, click **Details** on Humanify, and enable **Allow access to file URLs**.

## Privacy & Cost

Gemini and Groq have really generous free tiers that are honestly more than enough for personal use. If you hit a rate limit, just wait a bit and try again. OpenAI charges a tiny fraction of a cent per rewrite.

**Just a warning:** Your text gets sent to the API provider, so don't use this on anything confidential (like passwords or sensitive work docs). Also, remember that free tiers sometimes use your text to train their models.

## Tweak the chaos level

In the extension popup, you can choose your vibe: **Subtle**, **Funny**, or **Maximum chaos**. It saves your choice automatically.

If you want to dig into the code and mess around, open up `background.js` and look at section 3:
* **`TEMPERATURE`** (default is `0.9`): Crank this up toward `1.2` if you want the AI to go completely off the rails. Lower it toward `0.5` if you want safer, more predictable edits.
* **`FUN_RULES`**: These are the actual instructions sent to the AI. Rule 4 is where the humor lives—tweak it to change the vibe.
* **`PROVIDERS`**: This is the list of AI models it tries, in order. If a model gets retired or your account gets rate-limited, it just moves to the next one. You can add new models here whenever they drop.

If you want to change the 4000-character limit, that's in `content.js` (`MAX_CHARS`).

**Don't forget:** If you edit any of the code, you have to go back to `chrome://extensions`, click the little reload icon on the Humanify card, and refresh the page you're testing on.
