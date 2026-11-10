# Distraction Free (Focus Shield) 🛡️

A high-performance Chrome extension (Manifest V3) built to eliminate dopamine traps on **X (Twitter)** and **YouTube**.

---

## 🚀 Key Features

### 1. X (Twitter) Focus Guard & Magnetic North Pole Haptics
- **Permanently Blocked**:
  - The Home timeline is blocked at all times.
  - Automatically blocks the floating blue **"posted" / "Show posts" capsule**.
  - Automatically blocks the right sidebar widgets: **"What's happening"** (trending topics) and **"Who to follow"** (recommended accounts).
  - Bottom-right corner toggle button has been removed from the page.
- **Unblock Button Toggle (Default: FALSE)**:
  - Accessible via the Chrome extension popup: **"Show Unblock Button"**.
  - **By default, it is OFF (`false`)**. When off, no unblock button exists on the X page, providing zero temptation.
  - Can always be toggled via the emergency shortcut: `Alt + Shift + X`.
- **Magnetic North Pole Cursor Repulsion**:
  - When the unblock button is enabled, it is surrounded by a circular magnetic field.
  - **The button remains constant** (fixed in place).
  - **The cursor acts as a North Pole, the button acts as a North Pole**. They repel each other: approaching within $170\text{px}$ pushes your cursor far outward along the magnetic vector.
  - **Pressure-Based Breakthrough**: Moving your cursor vigorously against the field builds physical pressure (0% to 100%). When pressure reaches 100%, the magnetic shield overloads and breaches for 3.5 seconds, allowing you to click the button.
- **Anti-Distraction Message**:
  - Displays the quote:
    > **“How little we remember the tweets we scrolled. You are much better off reading a book or touching grass”**

---

### 2. YouTube Smart Recommendation Filter & Interactive Blocked Placeholders
While watching a video on YouTube (`/watch`):
- **Semantic Text Similarity Engine**:
  - Employs a custom, zero-dependency NLP algorithm ([`text_similarity.js`](file:///C:/Users/jinma/JDev/distraction-free/content/text_similarity.js)):
    1. **Text Normalization**: Strips emojis, clickbait punctuation, and YouTube stop words (`official`, `video`, `4k`, `episode`, `watch`, etc.).
    2. **Stemming**: English suffix stemmer for token alignment (`building` $\to$ `build`).
    3. **Hybrid Similarity Metric**: Combines TF-IDF Cosine Similarity ($40\%$), Token Overlap ($30\%$), Token Jaccard ($15\%$), and Character Trigram matching ($15\%$).
  - Recommendations below your similarity threshold (default: $20\%$) are blocked with a placeholder.
- **Interactive Blocked Placeholder (Title Withheld)**:
  - Blocked videos display a compact, distraction-free placeholder:
    - 🏷️ **Reason**: `Blocked: Low match (14%)`
    - 🚫 **No Distracting Titles**: Video titles are withheld from the blocked placeholder to protect your focus.
    - ⚡ **Optional Unblock**: When "Show Unblock Buttons" is enabled in the popup, an **`[ Unblock ]`** button appears directly on the placeholder.
    - ↺ **Re-block Support**: Unblocked videos display a discreet `[ Unblocked ↺ Re-block ]` tag so you can re-block anytime.
- **Automatic Ad & Topic Chip Stripping**:
  - Sponsored cards and ad slots are cleanly removed with zero height.
  - The topic chip cloud carousel ("The yt scroll down") is completely blocked.
- **Extension Popup Controls**:
  - Similarity strictness slider ($5\%$ to $50\%$).
  - Toggle to show/hide match percentage badges.
  - Toggle to show/hide unblock buttons (default: OFF).

---

## 📦 How to Install / Reload in Google Chrome

1. Open Google Chrome and go to `chrome://extensions`.
2. Ensure **Developer mode** is switched **ON** in the top-right corner.
3. If already loaded:
   - Click the **🔄 Reload** circular arrow icon on the **Distraction Free - Focus Shield** card.
4. If installing for the first time:
   - Click **Load unpacked** in the top-left corner and select:
     ```
     C:\Users\jinma\JDev\distraction-free
     ```
5. Refresh your X and YouTube tabs to enjoy pure focus!

---

## 🛠️ Offline Verification

Run the automated test suite in terminal:
```bash
node tests/similarity.test.js
```
