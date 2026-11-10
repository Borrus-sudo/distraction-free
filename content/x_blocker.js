/**
 * Distraction Free - X (Twitter) Blocker
 * Perf-optimised: debounced MutationObserver, cached rects, passive listeners,
 * rAF-only cursor rendering, no setInterval DOM scanning.
 */

(function () {
  'use strict';

  let isFeedBlocked = true;
  let showUnblockButton = false;

  // --- Cached DOM refs (nulled on card rebuild) ---
  let _btn = null;

  // --- URL tracking via Navigation API or polling fallback ---
  let lastUrl = location.href;

  // --- Observer ---
  let mutationObserver = null;
  let mutationDebounceId = null;

  // =========================================================================
  // Settings
  // =========================================================================

  function loadSettings(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
      chrome.storage.sync.get({ showXUnblockButton: false }, (items) => {
        showUnblockButton = !!items.showXUnblockButton;
        cb && cb();
      });
    } else {
      cb && cb();
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if ((area === 'sync' || area === 'local') && 'showXUnblockButton' in changes) {
        showUnblockButton = !!changes.showXUnblockButton.newValue;
        applyBlockState();
      }
    });
  }

  // =========================================================================
  // Helpers — identify Home, Explore, and Notifications + Compose State
  // =========================================================================

  // Tracks the underlying page before the compose modal opened
  let lastNonComposePath = '/home';

  function updateComposeState() {
    const isComposePath = location.pathname.toLowerCase().startsWith('/compose/');
    const hasComposeModal = !!document.querySelector(
      '#layers [data-testid="tweetTextarea_0"], #layers [role="dialog"], #layers [data-testid="mask"]'
    );
    const isComposeOpen = isComposePath || hasComposeModal;
    document.body.classList.toggle('df-compose-open', isComposeOpen);
  }

  function getBlockedPageType() {
    let path = location.pathname.toLowerCase();
    // If user opened compose modal (/compose/post or /compose/tweet), preserve underlying page state
    if (path.startsWith('/compose/')) {
      path = lastNonComposePath;
    } else {
      lastNonComposePath = path;
    }

    // 1. Home
    if (path === '/' || path === '/home') return 'home';
    // 2. Explore / Search / Trends
    if (path === '/explore' || path.startsWith('/explore/') || path.startsWith('/i/trends') || path.startsWith('/search')) return 'explore';
    // 3. Notifications
    if (path === '/notifications' || path.startsWith('/notifications/')) return 'notifications';
    return null;
  }

  const isHome = () => getBlockedPageType() === 'home';

  // =========================================================================
  // Posted capsule blocking — comprehensive detection for modern X
  // =========================================================================

  function processPostedCapsule() {
    if (!isFeedBlocked) {
      document.querySelectorAll('.df-x-blocked-posted-pill')
        .forEach(el => el.classList.remove('df-x-blocked-posted-pill'));
      return;
    }

    // 1. Target known testids and aria labels
    const pills = document.querySelectorAll(
      '[data-testid="pill-top"], [data-testid*="pillLabel"], [data-testid*="pill" i], [data-testid*="Pill" i], [data-testid*="newTweets" i], [aria-label*="new posts" i], [aria-label*="new tweets" i], [aria-label*="see new" i], [aria-label*="posted" i]'
    );
    pills.forEach(el => {
      el.classList.add('df-x-blocked-posted-pill');
      const parentWrap = el.closest('div[style*="fixed"], div[style*="absolute"]');
      if (parentWrap && parentWrap !== document.body && !parentWrap.id?.startsWith('df-x')) {
        parentWrap.classList.add('df-x-blocked-posted-pill');
      }
    });

    // 2. Scan interactive buttons/elements across document (excluding compose/tweet buttons)
    const candidates = document.querySelectorAll(
      'div[role="button"], button, div[tabindex="0"]'
    );

    candidates.forEach(el => {
      if (el.classList.contains('df-x-blocked-posted-pill')) return;
      if (el.id === 'df-x-btn-flip-action') return; // Do not touch our own unblock button!
      if (el.closest('#df-x-blocker-card')) return;
      if (el.closest('[data-testid="SideNav_NewTweet_Button"], [data-testid*="tweet" i], [data-testid*="follow" i], header nav')) return;

      const txt = (el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();

      // Check text or aria-label
      if (
        txt.includes('posted') || txt.includes('show posts') || txt.includes('new posts') ||
        aria.includes('posted') || aria.includes('new post') || aria.includes('see new')
      ) {
        el.classList.add('df-x-blocked-posted-pill');
        const parentFix = el.closest('div[style*="fixed"], div[style*="absolute"]');
        if (parentFix && !parentFix.id?.startsWith('df-x')) parentFix.classList.add('df-x-blocked-posted-pill');
        return;
      }

      // Check avatar pattern: the floating blue pill displays 2 or more overlapping avatar images
      const avatarImgs = el.querySelectorAll('img[src*="profile_images"], img[src*="twimg.com"], img[src*="pbs.twimg.com"]');
      if (avatarImgs.length >= 2) {
        el.classList.add('df-x-blocked-posted-pill');
        const parentFix = el.closest('div[style*="fixed"], div[style*="absolute"]');
        if (parentFix && !parentFix.id?.startsWith('df-x')) parentFix.classList.add('df-x-blocked-posted-pill');
        return;
      }

      // Check for X-blue background on floating pill buttons near top of viewport
      const hasSvg = el.querySelector('svg');
      if (hasSvg) {
        const bg = window.getComputedStyle(el).backgroundColor;
        if (bg.includes('29, 155, 240') || bg.includes('29, 161, 242')) {
          const rect = el.getBoundingClientRect();
          if (rect.top < 220 && rect.width < 320 && rect.height < 70) {
            el.classList.add('df-x-blocked-posted-pill');
            const parentFix = el.closest('div[style*="fixed"], div[style*="absolute"]');
            if (parentFix && !parentFix.id?.startsWith('df-x')) parentFix.classList.add('df-x-blocked-posted-pill');
          }
        }
      }
    });
  }

  // =========================================================================
  // Notification blocking — strips title counter and hides sidebar number capsule
  // =========================================================================

  function processNotifications() {
    // 1. Strip unread notification counts in the tab title, e.g. "(3) Home / X" -> "Home / X"
    if (/^\(\d+\)\s*/.test(document.title)) {
      document.title = document.title.replace(/^\(\d+\)\s*/, '');
    }

    // 2. Hide number capsule on the notifications sidebar link (regardless of feed flip)
    const notifLinks = document.querySelectorAll(
      'a[href*="/notifications"], a[data-testid*="Notifications"], a[aria-label*="Notification" i]'
    );
    notifLinks.forEach(link => {
      // Clean aria-label so screen readers/tooltips don't report unread count
      const aria = link.getAttribute('aria-label');
      if (aria && /\b\d+\s+unread/i.test(aria)) {
        link.setAttribute('aria-label', 'Notifications');
      }

      // Find badge, count, or any child element containing a number capsule
      const badges = link.querySelectorAll(
        '[data-testid="notificationBadge"], [data-testid="badge"], [data-testid="count"], div[dir="ltr"], div[style*="background-color"], span[style*="background-color"]'
      );
      badges.forEach(b => {
        const txt = b.textContent?.trim() || '';
        if (/^\d+\+?$/.test(txt) || b.getAttribute('data-testid')?.includes('badge') || b.getAttribute('data-testid')?.includes('notification')) {
          b.classList.add('df-x-blocked-notification-badge');
          b.style.setProperty('display', 'none', 'important');
        }
      });
      link.querySelectorAll('[aria-label*="unread" i]').forEach(b => {
        b.classList.add('df-x-blocked-notification-badge');
        b.style.setProperty('display', 'none', 'important');
      });
    });

    // 3. Hide any global notification badge dots/toasts on the page
    document.querySelectorAll('[data-testid="notificationBadge"], [data-testid="tabNotification"], [data-testid="toast"]').forEach(el => {
      if (el.id?.startsWith('df-')) return;
      el.classList.add('df-x-blocked-notification-badge');
      el.style.setProperty('display', 'none', 'important');
    });
  }

  // =========================================================================
  // Block state — Home, Explore, and Notifications are blocked; rest is usable
  // =========================================================================

  function applyBlockState() {
    updateComposeState();
    const pageType = getBlockedPageType();
    const onBlockedPage = !!pageType;

    document.body.classList.toggle('df-on-blocked-page', onBlockedPage);
    document.body.classList.toggle('df-on-home', pageType === 'home');
    document.body.classList.toggle('df-on-explore', pageType === 'explore');
    document.body.classList.toggle('df-on-notifications', pageType === 'notifications');
    document.body.classList.toggle('df-x-feed-blocked', isFeedBlocked);

    if (isFeedBlocked && onBlockedPage) {
      injectBlockerCard(pageType);
      processPostedCapsule();
    } else {
      removeBlockerCard();
      // On unblocked pages (profile, tweets, dms, etc.), ensure content is unblocked
      document.querySelectorAll('.df-x-blocked-posted-pill').forEach(el => el.classList.remove('df-x-blocked-posted-pill'));
    }

    // Notifications sidebar number capsule is ALWAYS kept hidden
    processNotifications();
  }

  // =========================================================================
  // Blocker card
  // =========================================================================

  function injectBlockerCard(pageType = 'home') {
    const primaryCol = document.querySelector('[data-testid="primaryColumn"]');
    if (!primaryCol) return;

    if (document.getElementById('df-x-blocker-card')) return; // already mounted

    const card = document.createElement('div');
    card.id = 'df-x-blocker-card';

    let headline = 'Getting to fucking work';
    let subtext = 'Home feed is locked. Focus on deep work.';
    if (pageType === 'explore') {
      headline = 'Explore is Locked';
      subtext = 'Explore feed is locked. Stay focused.';
    } else if (pageType === 'notifications') {
      headline = 'Notifications Locked';
      subtext = 'Notifications page is locked. Return to deep work.';
    }

    const unblockHtml = showUnblockButton ? `
      <div class="df-x-unblock-wrap">
        <button class="df-x-btn-flip" id="df-x-btn-flip-action" type="button">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          </svg>
          <span>Temporarily Unblock Feed</span>
        </button>
      </div>
    ` : '';

    card.innerHTML = `
      <svg class="df-x-icon-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="2"/>
        <path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="2.5"/>
      </svg>
      <h1 class="df-x-headline work-mode">${headline}</h1>
      <div class="df-x-quote-box">
        <span class="df-x-quote-mark">"</span>
        <p class="df-x-quote-text">How little we remember the tweets we scrolled and the shots we binged. You are better off sleeping or touching grass</p>
        <span class="df-x-quote-mark end">"</span>
      </div>
      <p class="df-x-subtext">${subtext}</p>
      ${unblockHtml}
      <div class="df-x-shortcut-hint">Emergency shortcut: Alt + Shift + X</div>
    `;

    primaryCol.prepend(card);

    if (showUnblockButton) {
      _btn = card.querySelector('#df-x-btn-flip-action');
      if (_btn) {
        _btn.addEventListener('click', () => toggleFeedFlip());
      }
    }
  }

  function removeBlockerCard() {
    document.querySelectorAll('#df-x-blocker-card').forEach(card => card.remove());
    _btn = null;
  }

  // =========================================================================
  // Public toggle
  // =========================================================================

  function toggleFeedFlip() {
    isFeedBlocked = !isFeedBlocked;
    applyBlockState();
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) toggleFeedFlip();
  });

  // =========================================================================
  // MutationObserver — debounced, smart node filtering
  // =========================================================================

  function scheduleMutationWork() {
    if (mutationDebounceId) return;         // coalesce within one frame
    mutationDebounceId = requestAnimationFrame(() => {
      mutationDebounceId = null;

      // Always update compose state in case modal opened without URL change or vice versa
      updateComposeState();

      // Instantly catch SPA URL transitions during DOM render
      if (location.href !== lastUrl) {
        onUrlChange();
        return;
      }

      if (!isFeedBlocked) return;

      // Notifications sidebar number capsule is kept hidden across all pages
      processNotifications();

      const pageType = getBlockedPageType();
      if (pageType) {
        // Only block on Home, Explore, and Notifications
        processPostedCapsule();
        const primaryCol = document.querySelector('[data-testid="primaryColumn"]');
        if (primaryCol && !document.getElementById('df-x-blocker-card')) {
          injectBlockerCard(pageType);
        }
      } else {
        // On unblocked pages (profile, tweet thread, DMs, etc.), ensure blocker card is gone!
        removeBlockerCard();
        document.body.classList.remove('df-on-blocked-page', 'df-on-home', 'df-on-explore', 'df-on-notifications');
        document.querySelectorAll('.df-x-blocked-posted-pill').forEach(el => el.classList.remove('df-x-blocked-posted-pill'));
      }
    });
  }

  // Nodes that should NOT trigger a re-scan
  const IGNORE_IDS = new Set(['df-x-blocker-card']);
  const IGNORE_CLASSES = ['df-x-blocked-posted-pill', 'df-x-blocked-notification-badge'];

  function initObserver() {
    if (mutationObserver) mutationObserver.disconnect();

    mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (IGNORE_IDS.has(node.id)) continue;
          if (IGNORE_CLASSES.some(c => node.classList?.contains(c))) continue;
          scheduleMutationWork();
          return; // one trigger is enough per batch
        }
      }
    });

    // Watch only direct children of body-level containers
    const targets = [
      document.body,
      document.querySelector('[data-testid="primaryColumn"]')
    ].filter(Boolean);

    targets.forEach(t => {
      mutationObserver.observe(t, { childList: true, subtree: true });
    });
  }

  // =========================================================================
  // URL change detection — Navigation API + popstate + click + timer
  // =========================================================================

  function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    applyBlockState();
  }

  function startUrlWatcher() {
    if ('navigation' in window) {
      navigation.addEventListener('navigatesuccess', onUrlChange);
      navigation.addEventListener('navigate', () => {
        requestAnimationFrame(onUrlChange);
      });
    }
    window.addEventListener('popstate', onUrlChange);

    // Click interceptor: catch link clicks instantly before React finishes mounting
    window.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (link && link.href) {
        requestAnimationFrame(() => {
          if (location.href !== lastUrl) onUrlChange();
        });
        setTimeout(() => {
          if (location.href !== lastUrl) onUrlChange();
        }, 50);
      }
    }, true);

    // Fast 100ms lightweight watchdog to detect any silent pushState transitions
    setInterval(() => {
      if (location.href !== lastUrl) {
        onUrlChange();
      }
    }, 100);
  }

  // =========================================================================
  // Init
  // =========================================================================

  function init() {
    loadSettings(() => applyBlockState());
    initObserver();
    startUrlWatcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
