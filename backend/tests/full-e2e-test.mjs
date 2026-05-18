import { chromium } from '@playwright/test';
import WebSocket from 'ws';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envContent.split('\n').filter(l => l && !l.startsWith('#')).map(l => { const eq = l.indexOf('='); return [l.slice(0, eq), l.slice(eq + 1).replace(/^["']|["']$/g, '')]; })
);

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001/api';
const WS = 'ws://localhost:3001';
const errors = [];

function report(r) {
  const s = r.passed ? '✅' : '❌';
  console.log(`  ${s} ${r.name}${r.passed ? '' : ' — ' + r.error}`);
  if (!r.passed) errors.push(r);
}

async function getTokenViaBrowser() {
  console.log('\n═══ Step 1: 浏览器注册并登录获取 JWT ═══\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Step 1.1: Navigate and check for existing session
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  const existingToken = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const val = localStorage.getItem(key);
      if (!val) continue;
      try {
        const parsed = JSON.parse(val);
        if (parsed?.access_token) return parsed.access_token;
      } catch {}
      if (val.startsWith('eyJ')) return val;
    }
    return null;
  });

  if (existingToken) {
    console.log('  ✅ 已有登录会话，直接获取 Token');
    await browser.close();
    return existingToken;
  }

  console.log('  未登录，进入注册流程...');

  // Step 1.2: Click "注册" button
  const regBtns = await page.$$('button');
  for (const btn of regBtns) {
    const text = await btn.textContent();
    if (text?.includes('注册')) {
      await btn.click();
      console.log('  ✅ 点击"注册"按钮');
      await page.waitForTimeout(2000);
      break;
    }
  }

  await page.screenshot({ path: resolve(__dirname, 'register-form.png'), fullPage: false });

  // Step 1.3: Find registration form inputs
  const allInputs = await page.$$('input');
  console.log(`  找到 ${allInputs.length} 个输入框`);
  for (const inp of allInputs) {
    const type = await inp.getAttribute('type');
    const placeholder = await inp.getAttribute('placeholder');
    const name = await inp.getAttribute('name');
    console.log(`    - type=${type} placeholder="${placeholder}" name="${name}"`);
  }

  // Fill registration form - look for name, email, password fields
  const uniqueId = Date.now();
  const testEmail = `handchat-e2e-${uniqueId}@example.com`;

  // Try to find and fill name field
  const nameInputs = await page.$$('input[placeholder*="昵称"], input[placeholder*="姓名"], input[placeholder*="name"], input[name*="name"]');
  for (const inp of nameInputs) {
    try { await inp.fill('E2ETester'); console.log('  ✅ 填写昵称'); } catch {}
  }

  // Fill email
  const emailInputs = await page.$$('input[type="email"], input[placeholder*="邮箱"], input[placeholder*="Email"]');
  for (const inp of emailInputs) {
    try { await inp.fill(testEmail); console.log(`  ✅ 填写邮箱: ${testEmail}`); } catch {}
  }

  // Fill password
  const pwInputs = await page.$$('input[type="password"]');
  for (const inp of pwInputs) {
    try {
      const ph = await inp.getAttribute('placeholder');
      if (!ph || ph.includes('确认')) continue; // skip confirm password
      await inp.fill('E2ETest123!');
      console.log('  ✅ 填写密码');
    } catch {}
  }

  // Fill confirm password if exists
  for (const inp of pwInputs) {
    try {
      const ph = await inp.getAttribute('placeholder');
      if (ph && ph.includes('确认')) {
        await inp.fill('E2ETest123!');
        console.log('  ✅ 填写确认密码');
      }
    } catch {}
  }

  // Screenshot after filling
  await page.screenshot({ path: resolve(__dirname, 'register-filled.png'), fullPage: false });

  // Click submit button
  const submitBtns = await page.$$('button');
  for (const btn of submitBtns) {
    const text = await btn.textContent();
    if (text?.includes('注册') && !text.includes('登录')) {
      await btn.click();
      console.log('  ✅ 点击提交注册');
      break;
    }
  }

  // Wait for response
  await page.waitForTimeout(6000);

  // Check for token
  const tokenAfterReg = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const val = localStorage.getItem(key);
      if (!val) continue;
      try {
        const parsed = JSON.parse(val);
        if (parsed?.access_token) return parsed.access_token;
      } catch {}
      if (val.startsWith('eyJ')) return val;
    }
    return null;
  });

  if (tokenAfterReg) {
    console.log('  ✅ 注册成功，已获取 JWT Token');
    await browser.close();
    return tokenAfterReg;
  }

  // If no token, try login flow instead
  console.log('  注册后未获取到 Token，尝试登录流程...');

  // Check if we're on login page now
  const bodyText = await page.textContent('body');
  console.log(`  当前页面: ${bodyText.slice(0, 400)}`);

  // Try to login with the same credentials
  const loginEmailInputs = await page.$$('input[type="email"]');
  const loginPwInputs = await page.$$('input[type="password"]');
  if (loginEmailInputs.length > 0 && loginPwInputs.length > 0) {
    for (const inp of loginEmailInputs) { try { await inp.fill(testEmail); } catch {} }
    for (const inp of loginPwInputs) {
      try {
        const ph = await inp.getAttribute('placeholder');
        if (ph?.includes('确认')) continue;
        await inp.fill('E2ETest123!');
      } catch {}
    }

    const loginBtns = await page.$$('button');
    for (const btn of loginBtns) {
      const text = await btn.textContent();
      if (text?.includes('登') && !text?.includes('注册')) {
        await btn.click();
        console.log('  ✅ 点击登录');
        break;
      }
    }

    await page.waitForTimeout(5000);

    const finalToken = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key);
        if (!val) continue;
        try {
          const parsed = JSON.parse(val);
          if (parsed?.access_token) return parsed.access_token;
        } catch {}
        if (val.startsWith('eyJ')) return val;
      }
      return null;
    });

    if (finalToken) {
      console.log('  ✅ 登录成功，已获取 JWT Token');
      await browser.close();
      return finalToken;
    }
  }

  console.log('  ❌ 无法自动获取 Token');
  await browser.close();
  return null;
}

function testRestApi(token) {
  return new Promise(async (resolve) => {
    console.log('\n═══ Step 2: REST API 鉴权验证 ═══\n');

    const r1 = await fetch(`${API}/sessions`);
    report({ name: '2.1 GET /sessions 无Token → 401', passed: r1.status === 401, error: `got ${r1.status}` });

    const r2 = await fetch(`${API}/sessions`, { headers: { Authorization: 'Bearer invalid-fake-jwt-token-abc123' } });
    report({ name: '2.2 GET /sessions 假Token → 401', passed: r2.status === 401, error: `got ${r2.status}` });

    const r3 = await fetch(`${API}/sessions`, { headers: { Authorization: `Bearer ${token}` } });
    const data3 = await r3.json().catch(() => null);
    report({ name: '2.3 GET /sessions 真Token → 200 + Array', passed: r3.status === 200 && Array.isArray(data3), error: `status=${r3.status}, isArray=${Array.isArray(data3)}` });

    resolve(data3);
  });
}

function testWebSocket(token) {
  return new Promise((resolve) => {
    console.log('\n═══ Step 3: WebSocket 假翻译全链路 ═══\n');

    const ws = new WebSocket(WS);
    let sid = null;
    let tCount = 0;
    const translations = [];
    let resolved = false;
    let gotSessionCreated = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        report({ name: '3.X 超时30s', passed: false, error: gotSessionCreated ? '未收到足够翻译消息' : '未收到session_created' });
        resolve(null);
      }
    }, 35000);

    ws.on('open', () => {
      report({ name: '3.0 WebSocket 连接建立', passed: true });
      console.log('  → 发送 session_start');
      ws.send(JSON.stringify({
        type: 'session_start',
        payload: { token },
        trace_id: crypto.randomUUID(),
        timestamp_ms: Date.now(),
      }));
    });

    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());

        if (m.type === 'error') {
          report({
            name: '3.X 后端错误',
            passed: false,
            error: `code=${m.payload?.code} message="${m.payload?.error}"`
          });
          clearTimeout(timer);
          if (!resolved) { resolved = true; ws.close(); resolve(null); }
          return;
        }

        if (m.type === 'session_created') {
          gotSessionCreated = true;
          sid = m.payload.session_id;
          console.log(`  📋 Session ID: ${sid}`);
          report({ name: '3.1 session_start → session_created 返回', passed: true });
        }

        if (m.type === 'translation') {
          tCount++;
          translations.push(m.payload);
          const emoji = m.payload.type === 'final' ? '📝' : m.payload.type === 'sentence_end' ? '🛑' : '📄';
          console.log(`  ${emoji} 翻译 #${tCount}: "${m.payload.text}" [${m.payload.type}] conf=${(m.payload.confidence*100).toFixed(0)}%`);

          report({
            name: `翻译 #${tCount}: "${m.payload.text}" (${m.payload.type})`,
            passed: !!m.payload.text && m.payload.confidence > 0,
            error: m.payload.text ? '' : 'text为空'
          });

          // Complete after 4+ translations and sentence_end
          if (tCount >= 4 && translations.some(t => t.type === 'sentence_end') && !resolved) {
            resolved = true;
            clearTimeout(timer);

            report({
              name: '3.5 假翻译完整序列（含 sentence_end）',
              passed: true
            });

            // Send session_end
            console.log(`  → 发送 session_end (${sid})`);
            ws.send(JSON.stringify({
              type: 'session_end',
              payload: { session_id: sid },
              trace_id: crypto.randomUUID(),
              timestamp_ms: Date.now(),
            }));

            report({ name: '3.6 session_end 发送', passed: true });

            setTimeout(() => {
              ws.close(1000, 'E2E test complete');
              resolve({ sid, translations });
            }, 800);
          }
        }

        if (m.type === 'pong') {
          // heartbeat - silent
        }

      } catch (e) {
        console.log(`  ⚠ 解析消息失败: ${e.message}`);
      }
    });

    ws.on('close', (code, reason) => {
      const reasonStr = typeof reason === 'string' ? reason : reason?.toString() || '';
      if (!resolved) {
        console.log(`  ⚠ WS关闭 code=${code} reason="${reasonStr}"`);
      }
    });

    ws.on('error', (e) => {
      if (!resolved) {
        report({ name: '3.X WebSocket 错误', passed: false, error: e.message });
        clearTimeout(timer);
        resolved = true;
        resolve(null);
      }
    });
  });
}

async function testDbVerify(token, sid) {
  console.log('\n═══ Step 4: 数据库持久化验证 ═══\n');

  await new Promise(r => setTimeout(r, 3000));

  // 4.1 Session list
  const r1 = await fetch(`${API}/sessions`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const sessions = await r1.json();
  const found = sessions.find(s => s.id === sid);
  report({
    name: '4.1 会话写入数据库 (GET /sessions)',
    passed: r1.status === 200 && !!found,
    error: found ? '' : `会话列表中未找到 ${sid}`
  });

  if (found) {
    report({
      name: '4.2 会话状态为 active 或 ended',
      passed: ['active', 'ended'].includes(found.status),
      error: `status="${found.status}"`
    });
    report({
      name: '4.3 翻译计数 > 0',
      passed: found.translationCount > 0,
      error: `translationCount=${found.translationCount}`
    });
  }

  // 4.2 Session detail
  const r2 = await fetch(`${API}/sessions/${sid}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const detail = await r2.json().catch(() => null);
  report({
    name: '4.4 会话详情可查 (GET /sessions/:id)',
    passed: r2.status === 200 && detail?.id === sid,
    error: `status=${r2.status}, idMatch=${detail?.id === sid}`
  });

  // 4.3 Translation history
  const r3 = await fetch(`${API}/sessions/${sid}/history`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const history = await r3.json().catch(() => null);
  report({
    name: '4.5 翻译历史可查 (GET /sessions/:id/history)',
    passed: r3.status === 200 && Array.isArray(history),
    error: `status=${r3.status}, isArray=${Array.isArray(history)}`
  });

  if (Array.isArray(history) && history.length > 0) {
    const sample = history[0];
    const fields = {
      hasText: !!sample.text,
      hasConfidence: typeof sample.confidence === 'number',
      hasType: !!sample.type,
      hasFrameId: typeof sample.frameId === 'number',
      hasCreatedAt: !!sample.createdAt,
    };
    const allFields = Object.values(fields).every(Boolean);
    report({
      name: '4.6 翻译记录字段完整 (text/confidence/type/frameId/createdAt)',
      passed: allFields,
      error: allFields ? '' : `缺失: ${Object.entries(fields).filter(([,v]) => !v).map(([k]) => k).join(', ')}`
    });
  }

  // 4.4 Unauthorized access protection (use someone else's session)
  if (history.length > 0) {
    const r4 = await fetch(`${API}/sessions/${sid}/history`);
    report({
      name: '4.7 无Token访问翻译历史 → 401',
      passed: r4.status === 401,
      error: `got ${r4.status}`
    });
  }
}

// ═══════════════════════════ MAIN ═══════════════════════════
async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     HandChat 全链路 E2E 自动化测试             ║');
  console.log(`║     ${new Date().toISOString()}                    ║`);
  console.log('╚════════════════════════════════════════════════╝');

  // Check backend
  try {
    const r = await fetch(`${API}/sessions`);
    console.log(`✅ 后端可达 (${API} → ${r.status})\n`);
  } catch {
    console.log('❌ 后端未运行！请先启动: cd backend && npm run dev');
    process.exit(1);
  }

  // Step 1: Get JWT token via browser
  const token = await getTokenViaBrowser();
  if (!token) {
    console.log('\n❌ 无法获取 JWT Token，中止测试');
    console.log('请确保:');
    console.log('  1. Supabase Auth > Settings > "Confirm email" = OFF');
    console.log('  2. 前端 http://localhost:5173 可以正常打开');
    console.log('  3. 没有邮箱频率限制（等待1-2分钟后重试）');
    console.log('  已保存截图到 tests/register-form.png & register-filled.png');
    process.exit(1);
  }

  console.log(`\n🔑 JWT Token: ${token.slice(0, 30)}...`);

  // Step 2: REST API
  await testRestApi(token);

  // Step 3: WebSocket
  const wsResult = await testWebSocket(token);
  if (!wsResult) {
    console.log('\n❌ WebSocket 测试失败，中止后续验证');
    await printSummary();
    return;
  }

  // Step 4: DB verification
  await testDbVerify(token, wsResult.sid);

  await printSummary();
}

async function printSummary() {
  console.log('\n╔════════════════════════════════════════════════╗');
  const passCount = (() => { let c = 0; /* don't count, just show */ return 'N/A'; })();
  if (errors.length === 0) {
    console.log('║  🎉  全部测试通过！                             ║');
  } else {
    console.log(`║  ⚠  测试完成 — ${errors.length} 项失败                           ║`);
  }
  console.log('╚════════════════════════════════════════════════╝');

  if (errors.length > 0) {
    console.log('\n失败项明细:');
    errors.forEach((e, i) => console.log(`  ${i + 1}. ❌ ${e.name}: ${e.error}`));
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main();
