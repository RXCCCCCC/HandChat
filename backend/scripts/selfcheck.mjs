#!/usr/bin/env node

const BASE = process.env.SELFCHECK_BASE || 'http://localhost:3001';
const WS_URL = process.env.SELFCHECK_WS || 'ws://localhost:3001';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name} — ${e.message}`);
    failed++;
  }
}

async function httpGet(path, expectedStatus = 200) {
  const res = await fetch(`${BASE}${path}`);
  if (res.status !== expectedStatus) {
    throw new Error(`expected ${expectedStatus}, got ${res.status}`);
  }
  return res.json();
}

(async () => {
  console.log('[selfcheck] HandChat Backend\n');

  await check(' 1. GET /health → 200', async () => {
    await httpGet('/health');
  });

  await check(' 2. Prisma DB connectivity', async () => {
    const data = await httpGet('/health');
    if (!data.time) throw new Error('missing time field');
  });

  await check(' 3. GET /api/sessions (no token) → 401', async () => {
    await httpGet('/api/sessions', 401);
  });

  await check(' 4. GET /api/sessions/:id (no token) → 401', async () => {
    await httpGet('/api/sessions/test-id', 401);
  });

  await check(' 5. GET /api/sessions/:id/history (no token) → 401', async () => {
    await httpGet('/api/sessions/test-id/history', 401);
  });

  console.log(`\n   Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('Note: Steps 6-13 (WS session_start/keypoints/translation/end) require wscat and a valid JWT token.');
    console.log('Run integration-test.mjs for full end-to-end after deployment.');
  }

  process.exit(failed > 0 ? 1 : 0);
})();
