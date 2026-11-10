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
  let _arena = null;
  let _resBar = null;
  let _resLabel = null;
  let _btnLabel = null;
  let _virtualCursor = null;

  // --- Cached button rect; invalidated on resize/scroll ---
  let _btnRect = null;
  let _btnRectStale = true;

  // --- URL tracking via Navigation API or polling fallback ---
  let lastUrl = location.href;
  let urlPollId = null;

  // --- Observer ---
  let mutationObserver = null;
  let mutationDebounceId = null;

  // --- Magnetic physics (all reads in mousemove, all writes in rAF) ---
  const mag = {
    pressure: 0,
    isBreached: false,
    breachTimerId: null,
    inArena: false,
    // Raw mouse position (written in mousemove, read in rAF)
    rawX: 0,
    rawY: 0,
    // Delta for inward-velocity calculation
    prevX: 0,
    prevY: 0,
    isMouseDown: false,
    rafId: null,
    // Rendered cursor position (smoothed)
    curX: 0,
    curY: 0
  };

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
  // Helpers — identify Home, Explore, and Notifications
  // =========================================================================

  function getBlockedPageType() {
    const path = location.pathname.toLowerCase();
    // 1. Home
    if (path === '/' || path === '/home') return 'home';
    // 2. Explore / Search / Trends
    if (path === '/explore' || path.startsWith('/explore/') || path.startsWith('/i/trends') || path.startsWith('/search')) return 'explore';
    // 3. Notifications
    if (path === '/notifications' || path.startsWith('/notifications/')) return 'notifications';
    return null;
  }

  const isHome = () => getBlockedPageType() === 'home';

  // Invalidate cached button rect whenever the viewport shifts
  const invalidateRect = () => { _btnRectStale = true; };
  window.addEventListener('resize', invalidateRect, { passive: true });
  window.addEventListener('scroll', invalidateRect, { passive: true });

  function getBtnRect() {
    if (_btnRectStale && _btn) {
      _btnRect = _btn.getBoundingClientRect();
      _btnRectStale = false;
    }
    return _btnRect;
  }

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

    const arenaHtml = showUnblockButton ? `
      <div class="df-x-magnetic-arena" id="df-x-magnetic-arena">
        <div class="df-x-field-ring outer"></div>
        <div class="df-x-field-ring inner"></div>
        <div class="df-x-pole-indicator">
          <span class="df-x-pole-badge">N</span>
          <span>North Pole Forcefield Active</span>
        </div>
        <button class="df-x-btn-flip" id="df-x-btn-flip-action" type="button">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span id="df-x-btn-label">Flip Feed: Unblock</span>
        </button>
        <div class="df-x-resistance-label" id="df-x-resistance-label">
          Magnetic Repulsion • Apply Pressure to Breach
        </div>
        <div class="df-x-resistance-bar-wrap">
          <div class="df-x-resistance-bar" id="df-x-resistance-bar"></div>
        </div>
      </div>
    ` : '';

    card.innerHTML = `
      <svg class="df-x-icon-shield" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-3zm-1 6h2v5h-2V8zm0 7h2v2h-2v-2z"/>
      </svg>
      <h1 class="df-x-headline work-mode">${headline}</h1>
      <div class="df-x-quote-box">
        <span class="df-x-quote-mark">"</span>
        <p class="df-x-quote-text">How little we remember the tweets we scrolled. You are much better off reading a book or touching grass.</p>
        <span class="df-x-quote-mark end">"</span>
      </div>
      <p class="df-x-subtext">${subtext}</p>
      ${arenaHtml}
      <div class="df-x-shortcut-hint">Emergency shortcut: Alt + Shift + X</div>
    `;

    primaryCol.prepend(card);

    if (showUnblockButton) {
      // Cache refs immediately after insertion
      _btn      = card.querySelector('#df-x-btn-flip-action');
      _arena    = card.querySelector('#df-x-magnetic-arena');
      _resBar   = card.querySelector('#df-x-resistance-bar');
      _resLabel = card.querySelector('#df-x-resistance-label');
      _btnLabel = card.querySelector('#df-x-btn-label');
      _btnRectStale = true;
      setupMagneticHaptics();
    }
  }

  function removeBlockerCard() {
    document.querySelectorAll('#df-x-blocker-card').forEach(card => card.remove());
    stopMagneticHaptics();
    _btn = _arena = _resBar = _resLabel = _btnLabel = null;
  }

  // =========================================================================
  // Virtual cursor
  // =========================================================================

  function getVirtualCursor() {
    if (_virtualCursor && document.body.contains(_virtualCursor)) return _virtualCursor;
    const el = document.createElement('div');
    el.id = 'df-x-north-cursor';
    el.className = 'hidden';
    el.textContent = 'N';
    document.body.appendChild(el);
    _virtualCursor = el;
    return el;
  }

  function hideVirtualCursor() {
    _virtualCursor?.classList.add('hidden');
  }

  function stopMagneticHaptics() {
    cancelAnimationFrame(mag.rafId);
    mag.rafId = null;
    mag.inArena = false;
    mag.pressure = 0;
    mag.isBreached = false;
    clearTimeout(mag.breachTimerId);
    hideVirtualCursor();
  }

  // =========================================================================
  // Magnetic North Pole Physics
  // =========================================================================

  function setupMagneticHaptics() {
    if (!_btn || !_arena) return;

    Object.assign(mag, {
      pressure: 0, isBreached: false, inArena: false,
      rawX: 0, rawY: 0, prevX: 0, prevY: 0, isMouseDown: false
    });

    const cursor = getVirtualCursor();

    _btn.addEventListener('click', (e) => {
      if (mag.isBreached) { e.stopPropagation(); toggleFeedFlip(); }
    });

    _arena.addEventListener('mouseenter', () => {
      mag.inArena = true;
      _arena.classList.add('repelling');
      cursor.classList.remove('hidden');
      _btnRectStale = true; // re-measure when entering
    });

    _arena.addEventListener('mouseleave', () => {
      mag.inArena = false;
      _arena.classList.remove('repelling');
      cursor.classList.add('hidden');
      mag.pressure = 0;
      setHud(0);
    });

    // Use addEventListener (not .onmousedown) so we don't clobber other handlers
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    // Start render loop
    cancelAnimationFrame(mag.rafId);
    mag.rafId = requestAnimationFrame(physicsRender);
  }

  function onMouseDown() { mag.isMouseDown = true; }
  function onMouseUp()   { mag.isMouseDown = false; }

  function onMouseMove(e) {
    if (!mag.inArena) return;

    mag.prevX = mag.rawX;
    mag.prevY = mag.rawY;
    mag.rawX  = e.clientX;
    mag.rawY  = e.clientY;

    // Inward-velocity pressure build — no getBoundingClientRect here
    const rect = getBtnRect();
    if (!rect) return;
    const bcx = rect.left + rect.width  / 2;
    const bcy = rect.top  + rect.height / 2;

    const dx = mag.rawX - bcx;
    const dy = mag.rawY - bcy;
    const dist = Math.hypot(dx, dy);

    if (dist > 0 && dist < 220) {
      const ux = dx / dist;
      const uy = dy / dist;
      // Inward movement = cursor moved toward centre
      const inward = -((mag.rawX - mag.prevX) * ux + (mag.rawY - mag.prevY) * uy);
      if (inward > 0) {
        mag.pressure = Math.min(100, mag.pressure + inward * 1.6);
      }
    }

    if (mag.isMouseDown) {
      mag.pressure = Math.min(100, mag.pressure + 2.0);
    }
  }

  // All DOM writes happen only inside the rAF callback
  function physicsRender() {
    if (!isFeedBlocked || !showUnblockButton) {
      hideVirtualCursor();
      return; // stop loop
    }

    const cursor = _virtualCursor;

    if (mag.inArena && _btn && _arena) {
      const rect  = getBtnRect();
      if (rect) {
        const bcx  = rect.left + rect.width  / 2;
        const bcy  = rect.top  + rect.height / 2;
        const dx   = mag.rawX - bcx;
        const dy   = mag.rawY - bcy;
        const dist = Math.hypot(dx, dy);
        const R    = 170;

        // Breach check
        if (mag.pressure >= 100 && !mag.isBreached) {
          mag.isBreached = true;
          _arena.classList.add('breached');
          _btn.classList.add('breached');
          cursor?.classList.add('breached');
          if (_btnLabel) _btnLabel.textContent = '⚡ Breached! Click to Unblock';

          clearTimeout(mag.breachTimerId);
          mag.breachTimerId = setTimeout(() => {
            mag.isBreached = false;
            mag.pressure   = 0;
            _arena?.classList.remove('breached');
            _btn?.classList.remove('breached');
            cursor?.classList.remove('breached');
            if (_btnLabel) _btnLabel.textContent = 'Flip Feed: Unblock';
            setHud(0);
          }, 3500);
        }

        // Pressure decay (not while breached)
        if (!mag.isBreached) {
          mag.pressure = Math.max(0, mag.pressure - 0.6);
        }

        setHud(mag.pressure);

        // Repulsion: cursor is pushed outward; button stays put
        let curX = mag.rawX;
        let curY = mag.rawY;

        if (!mag.isBreached && dist < R && dist > 0) {
          _arena.classList.add('active-repel');
          const ux = dx / dist;
          const uy = dy / dist;
          const strength = Math.pow((R - dist) / R, 1.3) * 160 * (1 - mag.pressure / 100);
          curX += ux * strength;
          curY += uy * strength;
        } else {
          _arena.classList.remove('active-repel');
        }

        // Write cursor position with transform (compositor layer, no layout)
        if (cursor) {
          cursor.style.transform = `translate(calc(${curX}px - 50%), calc(${curY}px - 50%))`;
        }
      }
    }

    mag.rafId = requestAnimationFrame(physicsRender);
  }

  // Throttled HUD update — only repaint when value changes meaningfully
  let _lastHudPct = -1;
  function setHud(pct) {
    const rounded = Math.round(pct);
    if (rounded === _lastHudPct) return;
    _lastHudPct = rounded;

    if (_resBar)   _resBar.style.width = `${pct}%`;
    if (_resLabel) {
      if (mag.isBreached) {
        _resLabel.textContent = '⚡ FIELD BREACHED — CLICK NOW!';
        _resLabel.style.color = '#34d399';
      } else if (pct > 0) {
        _resLabel.textContent = `Pressure: ${rounded}% — PUSH HARDER!`;
        _resLabel.style.color = '#fbbf24';
      } else {
        _resLabel.textContent = 'Magnetic Repulsion • Apply Pressure to Breach';
        _resLabel.style.color = '#9ca3af';
      }
    }
  }

  // =========================================================================
  // Public toggle
  // =========================================================================

  function toggleFeedFlip() {
    isFeedBlocked = !isFeedBlocked;
    // Remove stale listeners before rebuilding
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup',   onMouseUp);
    window.removeEventListener('mousemove', onMouseMove);
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
  const IGNORE_IDS = new Set(['df-x-blocker-card', 'df-x-north-cursor']);
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
    // Remove old magnetic listeners before rebuilding
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup',   onMouseUp);
    window.removeEventListener('mousemove', onMouseMove);
    stopMagneticHaptics();
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
