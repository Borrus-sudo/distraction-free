/**
 * Distraction Free - YouTube Recommendation Filter
 * Clean rewrite: correct caching, stable observer, no DOM thrash.
 */

(function () {
  'use strict';

  // =========================================================================
  // Config
  // =========================================================================

  const cfg = {
    ytFilterEnabled:    true,
    similarityThreshold: 0.20,
    showRevealed:       false,
    showScoreBadges:    true,
    showYtUnblockButton: false   // in-page controller toggle; default OFF
  };

  // =========================================================================
  // State
  // =========================================================================

  let currentVideoTitle = '';
  let debounceTimer     = null;
  let mutRafId          = null;
  let observer          = null;
  let lastUrl           = '';

  /**
   * Per-card cache.  WeakMap keys are card DOM elements (auto-GC'd).
   * Value: { forVideoTitle, recTitle, score, threshold, blockedState }
   * blockedState: 'low-similarity|<pct>' | 'kept' | 'user-unblocked'
   */
  const cardCache = new WeakMap();

  // =========================================================================
  // Settings
  // =========================================================================

  function loadSettings(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      chrome.storage.sync.get(
        {
          ytFilterEnabled: true,
          similarityThreshold: 0.20,
          showScoreBadges: true,
          showYtUnblockButton: false
        },
        (items) => { Object.assign(cfg, items); cb && cb(); }
      );
    } else {
      cb && cb();
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' && area !== 'local') return;
      let dirty = false;
      for (const key in changes) {
        if (key in cfg) {
          cfg[key] = changes[key].newValue;
          dirty = true;
        }
      }
      if (dirty) {
        if ('showYtUnblockButton' in changes) {
          applyUnblockBtnVisibility();
        }
        // Clear per-card cache so everything is re-evaluated
        getCards().forEach(c => cardCache.delete(c));
        scheduleFilter(0);
      }
    });
  }

  // =========================================================================
  // Video title
  // =========================================================================

  function refreshVideoTitle() {
    const el =
      document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
      document.querySelector('ytd-watch-metadata #title h1') ||
      document.querySelector('h1.style-scope.ytd-watch-metadata') ||
      document.querySelector('h1.title yt-formatted-string');

    const fromEl = el?.textContent.trim();
    if (fromEl) { currentVideoTitle = fromEl; return; }

    if (document.title.includes('- YouTube')) {
      currentVideoTitle = document.title
        .replace(/\s*-\s*YouTube$/i, '')
        .replace(/^\(\d+\)\s*/, '')
        .trim();
    }
  }

  // =========================================================================
  // Card discovery
  // =========================================================================

  const CARD_SELECTOR = [
    '#related ytd-compact-video-renderer',
    '#secondary ytd-compact-video-renderer',
    '#secondary yt-lockup-view-model',
    '#related yt-lockup-view-model',
    '#secondary ytd-rich-item-renderer',
    '#related ytd-rich-item-renderer',
    'ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer',
    'ytd-watch-next-secondary-results-renderer yt-lockup-view-model',
    'ytd-watch-next-secondary-results-renderer ytd-compact-radio-renderer',
    'ytd-watch-next-secondary-results-renderer ytd-compact-playlist-renderer',
    'ytd-watch-next-secondary-results-renderer ytd-rich-item-renderer'
  ].join(', ');

  function getCards() {
    return document.querySelectorAll(CARD_SELECTOR);
  }

  // =========================================================================
  // Title extraction — cached in card.dataset to avoid re-querying
  // =========================================================================

  const TITLE_SEL = '#video-title, span#video-title, #video-title-link, .yt-lockup-metadata-view-model__title, [class*="lockup-metadata-view-model__title"], h3 a, h3 span, h3';

  function getCardTitle(card) {
    const el = card.querySelector(TITLE_SEL);
    return (el?.getAttribute('title') || el?.getAttribute('aria-label') || el?.textContent || '').trim();
  }

  // =========================================================================
  // Block / unblock — only touch DOM when state actually changes
  // =========================================================================

  function blockCard(card, reason, score) {
    // Compute a stable state key for this blocked reason
    const pct      = score != null ? Math.round(score * 100) : null;
    const stateKey = pct != null ? `${reason}|${pct}` : reason;

    // Skip if already showing the exact same placeholder
    const cached = cardCache.get(card);
    if (cached?.blockedState === stateKey && card.classList.contains('df-yt-card-blocked')) return;

    // Update cache BEFORE DOM writes
    cardCache.set(card, { ...(cached ?? {}), blockedState: stateKey });

    card.classList.add('df-yt-card-blocked');
    card.dataset.dfReason = reason;
    if (pct != null) card.dataset.dfScore = pct;

    // Remove any stale unblocked tag
    card.querySelector('.df-unblocked-tag')?.remove();

    // Build or reuse the placeholder
    let ph = card.querySelector('.df-blocked-placeholder');
    if (!ph) {
      ph = document.createElement('div');
      ph.className = 'df-blocked-placeholder';
      card.appendChild(ph);
    }

    // Reason pill — exclusively similarity-based
    const pill = document.createElement('span');
    pill.className = 'df-reason-pill low-sim';
    pill.textContent = `Blocked: Low match (${pct != null ? pct : 0}%)`;

    // Note
    const note = document.createElement('span');
    note.className   = 'df-placeholder-note';
    note.textContent = 'Title hidden to protect your focus';

    const meta = document.createElement('div');
    meta.className = 'df-placeholder-meta';
    meta.appendChild(pill);
    meta.appendChild(note);

    const content = document.createElement('div');
    content.className = 'df-placeholder-content';
    content.appendChild(meta);

    // Unblock button — only appended if showYtUnblockButton is enabled (default is FALSE / OFF)
    if (cfg.showYtUnblockButton) {
      ph.replaceChildren(content, createUnblockBtn(card));
    } else {
      ph.replaceChildren(content);
    }
  }

  function createUnblockBtn(card) {
    const unblockBtn = document.createElement('button');
    unblockBtn.type      = 'button';
    unblockBtn.className = 'df-btn-unblock';
    unblockBtn.textContent = 'Unblock';
    unblockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      card.dataset.dfUserUnblocked = 'true';
      unblockCard(card);
      addReblockTag(card);
    }, { once: true });
    return unblockBtn;
  }

  function unblockCard(card) {
    card.classList.remove('df-yt-card-blocked');
    card.style.removeProperty('display');
    card.querySelector('.df-blocked-placeholder')?.remove();
  }

  function addReblockTag(card) {
    if (card.querySelector('.df-unblocked-tag')) return;
    const titleEl = card.querySelector(TITLE_SEL + ', h3');
    if (!titleEl?.parentNode) return;

    const tag       = document.createElement('span');
    tag.className   = 'df-unblocked-tag';
    const lbl       = document.createElement('span');
    lbl.textContent = 'Unblocked';
    const rblk      = document.createElement('button');
    rblk.type        = 'button';
    rblk.className   = 'df-btn-reblock';
    rblk.title       = 'Re-block this video';
    rblk.textContent = '↺ Re-block';
    rblk.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      delete card.dataset.dfUserUnblocked;
      delete card.dataset.dfTitle;
      cardCache.delete(card);
      tag.remove();
      scheduleFilter(0);
    }, { once: true });

    tag.appendChild(lbl);
    tag.appendChild(rblk);
    titleEl.parentNode.appendChild(tag);
  }

  // =========================================================================
  // Score badge
  // =========================================================================

  function attachScoreBadge(card, score) {
    if (!cfg.showScoreBadges) {
      card.querySelector('.df-yt-score-badge')?.remove();
      return;
    }
    const pct = Math.round(score * 100);
    let badge = card.querySelector('.df-yt-score-badge');
    if (!badge) {
      const titleEl = card.querySelector(TITLE_SEL + ', h3');
      if (!titleEl?.parentNode) return;
      badge = document.createElement('span');
      badge.className = 'df-yt-score-badge';
      titleEl.parentNode.appendChild(badge);
    }
    if (badge.dataset.pct === String(pct)) return; // already up to date
    badge.dataset.pct  = pct;
    badge.textContent  = `${pct}% match`;
    badge.title        = `Semantic match: ${pct}%`;
    badge.style.color       = pct >= 40 ? '#34d399' : '#818cf8';
    badge.style.borderColor = pct >= 40 ? 'rgba(52,211,153,0.4)' : 'rgba(99,102,241,0.4)';
  }

  // =========================================================================
  // Block YouTube Chip Cloud ("Scroll Down") & Ads / Sponsored Cards
  // =========================================================================

  function isAdCard(card) {
    if (!card) return false;
    // 1. Structural ad renderers inside the card
    if (card.querySelector('ytd-ad-slot-renderer, yt-ad-slot-view-model, .badge-style-type-ad, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer, ytd-statement-banner-renderer, ytd-companion-slot-renderer')) {
      return true;
    }
    // 2. Aria labels signaling ad/sponsored
    if (card.querySelector('[aria-label*="Sponsored" i], [aria-label*="Advertisement" i]')) {
      return true;
    }
    const cardAria = (card.getAttribute('aria-label') || '').toLowerCase();
    if (cardAria.includes('sponsored') || cardAria.includes('advertisement')) {
      return true;
    }
    // 3. Text content in badges / metadata
    const badges = card.querySelectorAll('badge-shape-wiz, .badge-shape-wiz, [class*="badge"], [class*="ad-"], [class*="attribution"], yt-formatted-string, span');
    for (const b of badges) {
      const t = (b.textContent || '').trim().toLowerCase();
      if (t === 'sponsored' || t.startsWith('sponsored •') || t.startsWith('sponsored ·') || t === 'ad') {
        return true;
      }
    }
    // 4. "Learn more" sponsored action button or ad link
    if (card.querySelector('[aria-label*="Learn more" i], a[href*="googleadservices"], a[href*="/pagead/"], yt-button-shape a[href*="http"]')) {
      return true;
    }
    return false;
  }

  function blockAdsAndChips() {
    // 1. Hide chip cloud / topic scroll bar ("The yt scroll down")
    const chips = document.querySelectorAll(
      'yt-related-chip-cloud-renderer, ytd-feed-filter-chip-bar-renderer, #related #chips, #secondary #chips, #secondary-inner #chips, iron-selector#chips, yt-chip-cloud-renderer, #header.ytd-watch-next-secondary-results-renderer'
    );
    chips.forEach(el => {
      // If it's #header, only hide if it contains chips or is empty of actual video titles
      if (el.id === 'header' && !el.querySelector('yt-related-chip-cloud-renderer, iron-selector#chips, yt-chip-cloud-renderer')) {
        return;
      }
      el.style.setProperty('display', 'none', 'important');
    });

    // 2. Hide all true ad slots & companion ads — NEVER parent item sections
    const adSlots = document.querySelectorAll(
      'ytd-ad-slot-renderer, yt-ad-slot-view-model, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer, ytd-statement-banner-renderer, ytd-banner-promo-renderer, ytd-companion-slot-renderer, #player-ads'
    );
    adSlots.forEach(el => {
      el.style.setProperty('display', 'none', 'important');
      // Only hide the immediately enclosing video card if it's an ad card
      const parentCard = el.closest('ytd-compact-video-renderer, yt-lockup-view-model, ytd-rich-item-renderer');
      if (parentCard) parentCard.style.setProperty('display', 'none', 'important');
    });

    // 3. Ensure recommendation sections are NEVER accidentally hidden
    document.querySelectorAll('ytd-item-section-renderer, #items, #contents, #secondary, #secondary-inner, ytd-watch-next-secondary-results-renderer').forEach(el => {
      if (el.style.display === 'none') {
        el.style.removeProperty('display');
      }
    });
  }

  // =========================================================================
  // Main filter
  // =========================================================================

  function runFilter() {
    if (!location.pathname.includes('/watch')) return;

    // Always block ads and chip bar
    blockAdsAndChips();

    if (!cfg.ytFilterEnabled) {
      getCards().forEach(c => {
        cardCache.delete(c);
        unblockCard(c);
      });
      return;
    }

    refreshVideoTitle();

    const cards = getCards();
    const eng = window.TextSimilarityEngine;

    cards.forEach((card) => {
      // ── Check if card is an Ad / Sponsored → hide completely ────────────
      if (isAdCard(card)) {
        card.style.setProperty('display', 'none', 'important');
        return;
      }

      // If card was previously marked as an ad but is now reused for a video, restore display
      if (card.style.display === 'none') {
        card.style.removeProperty('display');
      }

      // ── User manually unblocked → keep visible ─────────────────────────
      if (card.dataset.dfUserUnblocked === 'true') {
        if (card.classList.contains('df-yt-card-blocked')) unblockCard(card);
        return;
      }

      // ── Semantic Similarity Filter ────────────────────────────────────
      if (currentVideoTitle && eng) {
        const recTitle = getCardTitle(card);
        if (recTitle) {
          const cached = cardCache.get(card);
          let score;

          // Cache hit: same base video + same title + same threshold → reuse computed score
          if (
            cached?.forVideoTitle === currentVideoTitle &&
            cached?.recTitle === recTitle &&
            cached?.threshold === cfg.similarityThreshold
          ) {
            score = cached.score;
          } else {
            score = eng.calculateSimilarity(currentVideoTitle, recTitle).score;
            cardCache.set(card, {
              forVideoTitle: currentVideoTitle,
              recTitle,
              score,
              threshold: cfg.similarityThreshold,
              blockedState: null
            });
          }

          if (score < cfg.similarityThreshold) {
            blockCard(card, 'low-similarity', score);
          } else {
            if (card.classList.contains('df-yt-card-blocked')) unblockCard(card);
            attachScoreBadge(card, score);
          }
          return;
        }
      }

      // ── No title / engine not ready → keep visible ────────────────────
      if (card.classList.contains('df-yt-card-blocked')) unblockCard(card);
    });
  }

  // =========================================================================
  // Unblock-button visibility — controlled via extension popup (default OFF)
  // =========================================================================

  function applyUnblockBtnVisibility() {
    document.body.classList.toggle('df-yt-unblock-visible', !!cfg.showYtUnblockButton);

    // Sync all currently mounted blocked card placeholders
    document.querySelectorAll('.df-yt-card-blocked').forEach(card => {
      const ph = card.querySelector('.df-blocked-placeholder');
      if (!ph) return;
      let unblockBtn = ph.querySelector('.df-btn-unblock');

      if (cfg.showYtUnblockButton) {
        if (!unblockBtn) {
          ph.appendChild(createUnblockBtn(card));
        }
      } else {
        if (unblockBtn) {
          unblockBtn.remove();
        }
      }
    });
  }

  // =========================================================================
  // Scheduling
  // =========================================================================

  function scheduleFilter(delay = 150) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runFilter, delay);
  }

  // =========================================================================
  // MutationObserver — rAF-coalesced, only fires on relevant nodes
  // =========================================================================

  const RELEVANT_TAGS = new Set([
    'YTD-COMPACT-VIDEO-RENDERER',
    'YT-LOCKUP-VIEW-MODEL',
    'YTD-RICH-ITEM-RENDERER',
    'YTD-WATCH-NEXT-SECONDARY-RESULTS-RENDERER',
    'YTD-AD-SLOT-RENDERER',
    'YT-AD-SLOT-VIEW-MODEL',
    'YTD-IN-FEED-AD-LAYOUT-RENDERER',
    'YT-RELATED-CHIP-CLOUD-RENDERER',
    'YTD-FEED-FILTER-CHIP-BAR-RENDERER'
  ]);
  const OWN_CLASSES = new Set([
    'df-blocked-placeholder', 'df-unblocked-tag',
    'df-yt-score-badge', 'df-reason-pill', 'df-btn-unblock',
  ]);

  function isOwnNode(node) {
    if (node.classList) {
      for (const c of OWN_CLASSES) {
        if (node.classList.contains(c)) return true;
      }
    }
    return false;
  }

  function initObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      if (!location.pathname.includes('/watch')) return;

      let shouldRun = false;
      outer: for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (isOwnNode(node)) continue;

          if (
            RELEVANT_TAGS.has(node.tagName) ||
            node.querySelector?.('ytd-compact-video-renderer, yt-lockup-view-model, #video-title, ytd-ad-slot-renderer, yt-ad-slot-view-model, yt-related-chip-cloud-renderer')
          ) {
            shouldRun = true;
            break outer;
          }
        }
      }

      if (shouldRun) {
        blockAdsAndChips();
        if (!mutRafId) {
          mutRafId = requestAnimationFrame(() => {
            mutRafId = null;
            scheduleFilter(80);
          });
        }
      }
    });

    // Always watch body — specific containers may not exist at observer init time
    // (YouTube is a SPA; #secondary / #related mount asynchronously)
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // =========================================================================
  // Init
  // =========================================================================

  function init() {
    loadSettings(() => {
      applyUnblockBtnVisibility();
      scheduleFilter(400);
    });

    // YouTube SPA navigation events (most reliable signals)
    window.addEventListener('yt-navigate-finish', () => {
      currentVideoTitle = '';
      // Reset all cards so nothing from the previous video stays blocked or hidden
      getCards().forEach(c => {
        cardCache.delete(c);
        delete c.dataset.dfUserUnblocked;
        delete c.dataset.dfTitle;
        delete c.dataset.dfReason;
        delete c.dataset.dfScore;
        c.style.removeProperty('display');
        unblockCard(c);
      });
      // Ensure recommendation containers are NEVER hidden
      document.querySelectorAll('ytd-item-section-renderer, #items, #contents, #secondary, #secondary-inner, ytd-watch-next-secondary-results-renderer').forEach(el => {
        el.style.removeProperty('display');
      });
      blockAdsAndChips();
      scheduleFilter(200);
      scheduleFilter(600);
    });

    window.addEventListener('yt-page-data-updated', () => scheduleFilter(200));

    // Fallback URL watcher (Navigation API or rAF poll)
    const checkUrl = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (location.pathname.includes('/watch')) {
          blockAdsAndChips();
          scheduleFilter(400);
        }
      }
    };

    if ('navigation' in window) {
      navigation.addEventListener('navigate', checkUrl);
    } else {
      (function poll() { checkUrl(); requestAnimationFrame(poll); })();
    }

    initObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
