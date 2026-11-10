const assert = require('assert');
const engine = require('../content/text_similarity.js');

console.log('--- Running Similarity & Badge Engine Tests ---');

// Test 1: Identical titles
{
  const res = engine.calculateSimilarity('React 19 Full Course', 'React 19 Full Course');
  assert.strictEqual(res.score, 1.0, 'Identical titles should yield 1.0');
  console.log('✅ Test 1 Passed: Identical titles return 1.0');
}

// Test 2: Irrelevant / Disjoint titles
{
  const res = engine.calculateSimilarity('Advanced Rust Memory Management and Borrow Checker', 'Top 10 Cutest Cats on the Internet');
  assert(res.score <= 0.05, `Disjoint titles should have score near 0, got ${res.score}`);
  console.log('✅ Test 2 Passed: Disjoint titles have near 0 match');
}

// Test 3: High semantic overlap with different phrasing and clickbait symbols
{
  const res = engine.calculateSimilarity(
    '🔥 Building a FULLSTACK Next.js App with TypeScript [2026]!!',
    'Next.js Full Stack Tutorial: TypeScript and Tailwind CSS'
  );
  assert(res.score >= 0.35, `Expected >= 0.35 match, got ${res.score}`);
  assert(res.matchedTokens.includes('next'), 'Should match "next"');
  assert(res.matchedTokens.includes('typescript'), 'Should match "typescript"');
  console.log(`✅ Test 3 Passed: Semantic overlap score is ${res.score}`);
}

// Test 4: Stemming variation (building vs builds vs build, react vs reaction)
{
  const res = engine.calculateSimilarity(
    'How to Build Modern Web Applications',
    'Building Web Application Architecture'
  );
  assert(res.score >= 0.40, `Expected stemmed match >= 0.40, got ${res.score}`);
  console.log(`✅ Test 4 Passed: Stemming match score is ${res.score}`);
}

// Test 5: Empty / malformed inputs
{
  const res1 = engine.calculateSimilarity('', '');
  assert.strictEqual(res1.score, 0);
  const res2 = engine.calculateSimilarity(null, 'Valid Title');
  assert.strictEqual(res2.score, 0);
  console.log('✅ Test 5 Passed: Empty / null input safety');
}

// Test 6: Similarity threshold classification
{
  const threshold = 0.20;
  const match = engine.calculateSimilarity('Building a Web App in React', 'React Full Course for Beginners');
  const noMatch = engine.calculateSimilarity('Building a Web App in React', 'Playing Minecraft with Friends');
  assert(match.score >= threshold, `Expected ${match.score} >= ${threshold}`);
  assert(noMatch.score < threshold, `Expected ${noMatch.score} < ${threshold}`);
  console.log(`✅ Test 6 Passed: Similarity threshold correctly identifies relevant vs irrelevant recommendations`);
}

console.log('\nAll tests passed successfully!');
