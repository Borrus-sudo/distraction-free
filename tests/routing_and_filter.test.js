const assert = require('assert');

console.log('--- Running Routing, Title Stripping & Badge Classification Tests ---');

// Test 1: Page Type Classifier with Compose Handling
function getBlockedPageType(pathname) {
  const path = pathname.toLowerCase();
  // 0. Compose on X: everything remains blocked like the normal pages,
  // but the post box remains accessible
  if (path.startsWith('/compose/')) return 'home';
  // 1. Home
  if (path === '/' || path === '/home') return 'home';
  // 2. Explore / Search / Trends
  if (path === '/explore' || path.startsWith('/explore/') || path.startsWith('/i/trends') || path.startsWith('/search')) return 'explore';
  // 3. Notifications
  if (path === '/notifications' || path.startsWith('/notifications/')) return 'notifications';
  return null;
}

// Blocked pages
assert.strictEqual(getBlockedPageType('/'), 'home');
assert.strictEqual(getBlockedPageType('/home'), 'home');
assert.strictEqual(getBlockedPageType('/explore'), 'explore');
assert.strictEqual(getBlockedPageType('/explore/tabs/for-you'), 'explore');
assert.strictEqual(getBlockedPageType('/i/trends'), 'explore');
assert.strictEqual(getBlockedPageType('/search'), 'explore');
assert.strictEqual(getBlockedPageType('/notifications'), 'notifications');
assert.strictEqual(getBlockedPageType('/notifications/verified'), 'notifications');
assert.strictEqual(getBlockedPageType('/compose/post'), 'home');
assert.strictEqual(getBlockedPageType('/compose/tweet'), 'home');
console.log('✅ Test 1 Passed: Home, Explore, Notifications, and /compose/ correctly identified as blocked');

// Unblocked pages ("rest everything should be useable")
assert.strictEqual(getBlockedPageType('/elonmusk'), null);
assert.strictEqual(getBlockedPageType('/username/status/1888999'), null);
assert.strictEqual(getBlockedPageType('/messages'), null);
assert.strictEqual(getBlockedPageType('/i/bookmarks'), null);
assert.strictEqual(getBlockedPageType('/i/lists/12345'), null);
assert.strictEqual(getBlockedPageType('/settings'), null);
console.log('✅ Test 2 Passed: Profiles, Tweets, DMs, Bookmarks remain unblocked (usable)');

// Test 3: Tab Title Notification Counter Stripping
function stripTitleCounter(title) {
  return title.replace(/^\(\d+\+?\)\s*/, '');
}
assert.strictEqual(stripTitleCounter('(3) Home / X'), 'Home / X');
assert.strictEqual(stripTitleCounter('(99+) Notifications / X'), 'Notifications / X');
assert.strictEqual(stripTitleCounter('Home / X'), 'Home / X');
assert.strictEqual(stripTitleCounter('(1) Building Modern UI - YouTube'), 'Building Modern UI - YouTube');
console.log('✅ Test 3 Passed: Tab title notification counter stripping works correctly');

// Test 4: Notification badge digit classifier
const isNumericBadge = (text) => /^\d+\+?$/.test((text || '').trim());
assert.strictEqual(isNumericBadge('1'), true);
assert.strictEqual(isNumericBadge('9'), true);
assert.strictEqual(isNumericBadge('99+'), true);
assert.strictEqual(isNumericBadge('Notifications'), false);
assert.strictEqual(isNumericBadge('Home'), false);
assert.strictEqual(isNumericBadge(''), false);
console.log('✅ Test 4 Passed: Only numeric badges are identified, preserving text labels');

// Test 5: Sponsored ad keywords classification
function isSponsoredKeyword(text) {
  const t = (text || '').trim().toLowerCase();
  return t === 'sponsored' || t.startsWith('sponsored •') || t.startsWith('sponsored ·') || t === 'ad';
}
assert.strictEqual(isSponsoredKeyword('Sponsored'), true);
assert.strictEqual(isSponsoredKeyword('Sponsored • Gemini'), true);
assert.strictEqual(isSponsoredKeyword('Sponsored · Google'), true);
assert.strictEqual(isSponsoredKeyword('Ad'), true);
assert.strictEqual(isSponsoredKeyword('Learn React Today'), false);
console.log('✅ Test 5 Passed: Sponsored labels detected reliably');

console.log('\nAll routing & filter tests passed successfully!');
