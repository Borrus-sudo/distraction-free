/**
 * Text Similarity & Filtering Engine for YouTube Recommendations
 * Distraction Free Extension
 */

(function (global) {
  'use strict';

  // Common English & YouTube noise words to filter out
  const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t',
    'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
    'can', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t',
    'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t',
    'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers',
    'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if',
    'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most',
    'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
    'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d',
    'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s',
    'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they',
    'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too', 'under',
    'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were',
    'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who',
    'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d',
    'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
    // Clickbait & metadata noise
    'video', 'official', 'hd', '4k', 'watch', 'full', 'episode', 'shorts', 'yt', 'channel',
    'views', 'new', 'latest', 'live', 'stream'
  ]);

  /**
   * Lightweight English suffix stemmer
   */
  function stemWord(word) {
    if (!word || word.length <= 3) return word;
    return word
      .replace(/(ing|edly|edly|fully|lessly)$/, '')
      .replace(/(tion|sion|ment|ness|able|ible)$/, '')
      .replace(/(ies)$/, 'y')
      .replace(/(es|ed|er|ly|s)$/, '');
  }

  /**
   * Clean and normalize text
   */
  function cleanText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      // Remove emojis and non-alphanumeric/non-spacing characters
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract stemmed tokens excluding stop words
   */
  function tokenize(text) {
    const cleaned = cleanText(text);
    if (!cleaned) return [];
    
    return cleaned
      .split(' ')
      .filter(w => w.length > 1 && !STOP_WORDS.has(w))
      .map(stemWord);
  }

  /**
   * Compute character 3-grams for subword matching
   */
  function getTrigrams(str) {
    const s = `  ${str.toLowerCase().replace(/[^a-z0-9]/g, ' ')} `;
    const trigrams = new Set();
    for (let i = 0; i <= s.length - 3; i++) {
      trigrams.add(s.substring(i, i + 3));
    }
    return trigrams;
  }

  /**
   * Jaccard similarity between two Sets
   */
  function setJaccard(setA, setB) {
    if (!setA.size || !setB.size) return 0;
    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Cosine similarity of term frequency vectors
   */
  function cosineSimilarity(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return 0;

    const freqA = {};
    const freqB = {};
    for (const t of tokensA) freqA[t] = (freqA[t] || 0) + 1;
    for (const t of tokensB) freqB[t] = (freqB[t] || 0) + 1;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const t in freqA) {
      normA += freqA[t] * freqA[t];
      if (freqB[t]) {
        dotProduct += freqA[t] * freqB[t];
      }
    }
    for (const t in freqB) {
      normB += freqB[t] * freqB[t];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Overlap coefficient: |A ∩ B| / min(|A|, |B|)
   * High if a shorter title is largely contained in the longer title
   */
  function overlapCoefficient(setA, setB) {
    if (!setA.size || !setB.size) return 0;
    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }
    const minSize = Math.min(setA.size, setB.size);
    return minSize === 0 ? 0 : intersection / minSize;
  }

  /**
   * Composite similarity calculation between two titles.
   * Returns a normalized score between 0.0 (no match) and 1.0 (identical/very high match)
   * along with diagnostic details.
   */
  function calculateSimilarity(titleA, titleB) {
    if (!titleA || !titleB) {
      return { score: 0, matchedTokens: [], details: { cosine: 0, jaccard: 0, overlap: 0, trigram: 0 } };
    }

    const tokensA = tokenize(titleA);
    const tokensB = tokenize(titleB);

    if (tokensA.length === 0 || tokensB.length === 0) {
      const triA = getTrigrams(titleA);
      const triB = getTrigrams(titleB);
      const triScore = setJaccard(triA, triB);
      return {
        score: Math.round(triScore * 100) / 100,
        matchedTokens: [],
        details: { cosine: 0, jaccard: 0, overlap: 0, trigram: triScore }
      };
    }

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);

    const matchedTokens = [];
    for (const item of setA) {
      if (setB.has(item)) matchedTokens.push(item);
    }

    const cosine = cosineSimilarity(tokensA, tokensB);
    const jaccard = setJaccard(setA, setB);
    const overlap = overlapCoefficient(setA, setB);

    const triA = getTrigrams(titleA);
    const triB = getTrigrams(titleB);
    const trigram = setJaccard(triA, triB);

    // Weighted composite score:
    // Cosine (TF-IDF style): 40%
    // Overlap (subset matching): 30%
    // Token Jaccard: 15%
    // Subword Trigram: 15%
    let composite = (cosine * 0.40) + (overlap * 0.30) + (jaccard * 0.15) + (trigram * 0.15);

    // Boost if multiple significant tokens matched exactly
    if (matchedTokens.length >= 2) {
      composite = Math.min(1.0, composite * 1.15);
    }

    const finalScore = Math.round(Math.min(1.0, Math.max(0.0, composite)) * 100) / 100;

    return {
      score: finalScore,
      matchedTokens,
      details: {
        cosine: Math.round(cosine * 100) / 100,
        jaccard: Math.round(jaccard * 100) / 100,
        overlap: Math.round(overlap * 100) / 100,
        trigram: Math.round(trigram * 100) / 100
      }
    };
  }

  /**
   * Helper to inspect whether an element has a "New" badge.
   * Matches YouTube's badge structures, Wiz components, and thumbnail overlays.
   */
  function isBadgeTextNew(str) {
    if (!str) return false;
    const s = str.trim();
    // Exact "New" or "New!" — also match "New video", "New release", "New upload"
    // But NOT "New York", timestamps like "2 days ago", channel names, etc.
    if (/^new!?$/i.test(s)) return true;
    if (/^new\s*(video|release|upload|episode|content)?!?$/i.test(s)) return true;
    // Handle aria-labels like "New - video title" or "New video badge"
    if (/^new\s*[-–—]/i.test(s) && s.length < 30) return true;
    return false;
  }

  function elementHasNewBadge(cardElement) {
    if (!cardElement) return false;

    // Check 0: aria-label directly on the card renderer itself
    // YouTube sets aria-label="New" on ytd-compact-video-renderer in some builds
    const cardAria = (cardElement.getAttribute('aria-label') || '').toLowerCase();
    if (cardAria === 'new' || cardAria.startsWith('new ') || cardAria.startsWith('new,')) {
      // Only if it's specifically a "New" badge signal, not just the video title
      if (/\bnew\b/i.test(cardAria) && cardAria.length < 30) return true;
    }

    // Check 1: Any badge-specific elements (Polymer, Lit, Wiz, legacy)
    const badgeSelectors = [
      'badge-shape-wiz',
      '.badge-shape-wiz',
      '.badge-shape-wiz__text',
      'yt-thumbnail-badge-view-model',
      '.yt-thumbnail-badge-view-model',
      'yt-thumbnail-overlay-badge-view-model',
      'ytd-thumbnail-overlay-badge-renderer',
      'ytd-thumbnail-overlay-time-status-renderer',
      'ytd-badge-supported-renderer',
      '.badge-style-type-simple',
      '#overlays',
      '.ytp-ce-element',
      '[class*="badge"]',
      '[class*="overlay-badge"]',
      '[class*="thumbnail-badge"]'
    ].join(', ');

    const badges = cardElement.querySelectorAll(badgeSelectors);
    for (const b of badges) {
      // Check aria-label / title
      const aria = (b.getAttribute('aria-label') || b.getAttribute('title') || '').trim();
      if (isBadgeTextNew(aria)) {
        return true;
      }

      // Check text content on leaf or short nodes
      const text = (b.textContent || '').trim();
      if (text.length <= 15 && isBadgeTextNew(text)) {
        return true;
      }
    }

    // Check 2: Inspect all elements inside thumbnail container
    const thumbArea = cardElement.querySelector(
      'ytd-thumbnail, #thumbnail, a[href*="/watch"], .yt-lockup-view-model__content-image, [class*="thumbnail"]'
    );
    if (thumbArea) {
      const descendants = thumbArea.querySelectorAll('*');
      for (const el of descendants) {
        const aria = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
        if (isBadgeTextNew(aria)) return true;

        if (el.children.length <= 1) {
          const text = (el.textContent || '').trim();
          if (text.length <= 15 && isBadgeTextNew(text)) {
            return true;
          }
        }
      }

      // TreeWalker scan on text nodes in thumbnail
      if (typeof document !== 'undefined' && document.createTreeWalker) {
        try {
          const walker = document.createTreeWalker(thumbArea, NodeFilter.SHOW_TEXT, null, false);
          let node;
          while ((node = walker.nextNode())) {
            const val = (node.nodeValue || '').trim();
            if (isBadgeTextNew(val)) {
              return true;
            }
          }
        } catch (e) {
          // ignore walker errors
        }
      }
    }

    // Check 3: Check aria-label="New" on any element in the card
    const ariaNew = cardElement.querySelectorAll('[aria-label="New" i], [title="New" i]');
    if (ariaNew.length > 0) return true;

    return false;
  }

  const TextSimilarityEngine = {
    cleanText,
    tokenize,
    stemWord,
    calculateSimilarity,
    elementHasNewBadge,
    isBadgeTextNew,
    STOP_WORDS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextSimilarityEngine;
  } else {
    global.TextSimilarityEngine = TextSimilarityEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
