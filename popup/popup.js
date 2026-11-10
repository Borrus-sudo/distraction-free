/**
 * Distraction Free - Popup Script
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const toggleXBlocker = document.getElementById('toggle-x-blocker');
  const toggleShowUnblockX = document.getElementById('toggle-show-unblock-x');
  const toggleYtFilter = document.getElementById('toggle-yt-filter');
  const similaritySlider = document.getElementById('similarity-slider');
  const similarityVal = document.getElementById('similarity-val');
  const toggleScoreBadges = document.getElementById('toggle-score-badges');
  const toggleShowUnblockYt = document.getElementById('toggle-show-unblock-yt');

  /**
   * Load stored settings
   */
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({
      xBlockerEnabled: true,
      showXUnblockButton: false, // Default is FALSE as requested
      ytFilterEnabled: true,
      similarityThreshold: 0.20,
      showScoreBadges: true,
      showYtUnblockButton: false // Default is FALSE
    }, (items) => {
      if (toggleXBlocker) toggleXBlocker.checked = items.xBlockerEnabled !== false;
      if (toggleShowUnblockX) toggleShowUnblockX.checked = !!items.showXUnblockButton;
      if (toggleYtFilter) toggleYtFilter.checked = items.ytFilterEnabled !== false;
      const pct = Math.round(items.similarityThreshold * 100);
      if (similaritySlider) similaritySlider.value = pct;
      if (similarityVal) similarityVal.textContent = `${pct}%`;
      if (toggleScoreBadges) toggleScoreBadges.checked = !!items.showScoreBadges;
      if (toggleShowUnblockYt) toggleShowUnblockYt.checked = !!items.showYtUnblockButton;
    });
  }

  /**
   * Save setting helper
   */
  function saveSetting(key, val) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const obj = {};
      obj[key] = val;
      chrome.storage.sync.set(obj);
    }
  }

  // Event Listeners
  if (toggleXBlocker) {
    toggleXBlocker.addEventListener('change', (e) => {
      saveSetting('xBlockerEnabled', e.target.checked);
    });
  }
  if (toggleShowUnblockX) {
    toggleShowUnblockX.addEventListener('change', (e) => {
      saveSetting('showXUnblockButton', e.target.checked);
    });
  }

  if (toggleYtFilter) {
    toggleYtFilter.addEventListener('change', (e) => {
      saveSetting('ytFilterEnabled', e.target.checked);
    });
  }

  if (similaritySlider) {
    similaritySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (similarityVal) similarityVal.textContent = `${val}%`;
      saveSetting('similarityThreshold', val / 100);
    });
  }

  if (toggleScoreBadges) {
    toggleScoreBadges.addEventListener('change', (e) => {
      saveSetting('showScoreBadges', e.target.checked);
    });
  }

  if (toggleShowUnblockYt) {
    toggleShowUnblockYt.addEventListener('change', (e) => {
      saveSetting('showYtUnblockButton', e.target.checked);
    });
  }
});
