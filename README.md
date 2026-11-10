# Distraction Free (Focus Shield) 🛡️

A lightweight, zero-dependency Chrome extension (Manifest V3) designed to eliminate algorithmic dopamine traps on **X (Twitter)** and **YouTube** while keeping essential productivity features accessible.

---

## 🚀 Key Features

### 1. X (Twitter) Focus Guard
- **Targeted Blocking**:
  - Automatically blocks addictive infinite-scroll pages: **Home** (`/`, `/home`), **Explore / Search / Trends** (`/explore`, `/search`, `/i/trends`), and **Notifications** (`/notifications`).
  - Displays a clean Focus Shield blocker card with a mindful quote (*"How little we remember the tweets we scrolled and the shots we binged. You are better off sleeping or touching grass"*) on blocked pages.
- **Specific Tweets & Profiles Always Work**:
  - Direct tweet links and conversation threads (`/username/status/...`) remain 100% usable.
  - User profile pages (`/username`), Direct Messages (`/messages`), Bookmarks (`/i/bookmarks`), and Lists are never blocked.
- **Post Composer Background Blur**:
  - When pressing "Post" or navigating to `/compose/post`, the underlying background feed remains strictly blocked and heavily blurred (`blur(16px)` + backdrop mask) so focus is never broken while writing.
- **Silenced Distraction Triggers**:
  - **Floating Blue "Posted" Capsule**: The floating pill prompting you to scroll back to top for new tweets is hidden.
  - **Notification Badge Silenced**: The blue unread number capsule on the Notifications bell link in the sidebar is hidden, and unread count badges in tab titles `(3)` are stripped.
- **Manual Unblock & Emergency Override**:
  - An optional manual unblock button can be toggled on inside the extension popup (disabled by default).
  - Emergency shortcut: `Alt + Shift + X`.

---

### 2. YouTube Semantic Recommendation Filter
- **Semantic Text Similarity Engine**:
  - Employs a custom, zero-dependency client-side NLP engine combining:
    1. **Text Normalization**: Strips emojis, clickbait punctuation, and common platform noise words (`official`, `video`, `4k`, `episode`, `watch`, etc.).
    2. **Stemming**: English suffix stemmer for token alignment (`building` $\to$ `build`).
    3. **Hybrid Metric**: TF-IDF Cosine Similarity ($40\%$), Token Overlap ($30\%$), Token Jaccard ($15\%$), and Character Trigram matching ($15\%$).
  - Evaluates live recommendations against the currently playing video title.
- **Distraction-Free Placeholders**:
  - Video recommendations scoring below your strictness threshold are replaced with compact placeholders (`Blocked: Low match (X%)`).
  - Video titles and thumbnails are withheld from blocked placeholders to prevent curiosity-driven distraction loops.
- **Ad & Topic Cloud Removal**:
  - Sponsored recommendation cards and ad slots are cleanly removed with zero height.
  - The horizontal topic chip carousel ("The yt scroll down") is blocked automatically.
- **Popup Controls**:
  - Similarity strictness slider ($5\%$ to $50\%$).
  - Toggle to show/hide match percentage badges on recommendations.
  - Toggle to show/hide `[Unblock]` buttons on placeholders (default: OFF).

---

## 📦 Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/Borrus-sudo/distraction-free.git
   cd distraction-free
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `distraction-free` project directory.
6. Refresh your X and YouTube tabs to begin your focused session!

---

## 🛠️ Testing & Verification

Run the automated test suites using Node.js:

```bash
# Test the text similarity engine
node tests/similarity.test.js

# Test route classification and title/badge filters
node tests/routing_and_filter.test.js
```

---

## 📄 License

MIT License. Feel free to use, modify, and contribute!
