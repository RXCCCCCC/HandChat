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

async function getTokenFromBrowser() {
  console.log('\n═══ 通过浏览器获取 JWT ═══');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Navigate, wait for supabase to restore session
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Extract from localStorage
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const val = localStorage.getItem(key);
      if (!val) continue;
      try {
        const parsed = JSON.parse(val);
        if (parsed?.access_token) return parsed.access_token;
        if (parsed?.provider_token) return parsed.provider_token;
      } catch {}
      if (val.startsWith('eyJ')) return val;
    }
    return null;
  });

  if (token) {
    console.log(`  ✅ 从浏览器 localStorage 获取到 Token`);
    await browser.close();
    return token;
  }

  // No token - try to find login form
  console.log('  浏览器未登录，查找登录表单...');
  const pageTitle = await page.title();
  console.log(`  页面标题: "${pageTitle}"`);

  // Take screenshot
  await page.screenshot({ path: resolve(__dirname, 'login-page.png'), fullPage: false });

  // Try to find any button that might lead to login
  const buttons = await page.$$eval('button, a', els => els.map(e => ({
    text: e.textContent?.trim().slice(0, 40),
    tag: e.tagName,
    href: e.tagName === 'A' ? e.href : ''
  })).filter(b => b.text));

  console.log(`  页面按钮/链接: ${JSON.stringify(buttons.slice(0, 10))}`);

  // Look for login link/button
  for (const btn of buttons) {
    if (btn.text?.includes('登录') || btn.text?.includes('Login') || btn.text?.includes('Sign In') || btn.text?.includes('登')) {
      console.log(`  找到登录入口: "${btn.text}"`);
      if (btn.tag === 'A' && btn.href) {
        await page.goto(btn.href, { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(2000);
        break;
      }
    }
  }

  // Try to find email and password inputs
  const inputs = await page.$$eval('input', els => els.map(e => ({
    type: e.type,
    name: e.name,
    placeholder: e.placeholder,
    id: e.id
  })));
  console.log(`  输入框: ${JSON.stringify(inputs)}`);

  // Try to fill and submit the login form
  const emailInput = await page.$('input[type="email"]');
  const pwInput = await page.$('input[type="password"]');
  if (emailInput && pwInput) {
    console.log('  尝试自动登录...');
    await emailInput.fill('handchat-dev@example.com');
    await pwInput.fill('Test123456!');

    // Click the login button
    const loginBtn = await page.$('button:has-text("登录"), button[type="submit"]');
    if (loginBtn) {
      await loginBtn.click();
      console.log('  已点击登录按钮，等待响应...');
      await page.waitForTimeout(5000);

      // Check for token again
      const token2 = await page.evaluate(() => {
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

      if (token2) {
        console.log('  ✅ 登录成功，获取到 JWT Token');
        await browser.close();
        return token2;
      }

      // Check for error messages
      const bodyText = await page.textContent('body');
      console.log(`  登录后页面内容: ${bodyText.slice(0, 500)}`);
    }
  }

  await browser.close();
  return null;
}

async function testRestApi(token) {
  console.log('\n═══ Phase 1: REST API 鉴权 ═══\n');

  const r1 = await fetch(`${API}/sessions`);
  report({ name: '1.1 无Token→401', passed: r1.status === 401, error: `got ${r1.status}` });

  const r2 = await fetch(`${API}/sessions`, { headers: { Authorization: 'Bearer faketoken123' } });
  report({ name: '1.2 假Token→401', passed: r2.status === 401, error: `got ${r2.status}` });

  const r3 = await fetch(`${API}/sessions`, { headers: { Authorization: `Bearer ${token}` } });
  const data3 = await r3.json().catch(() => null);
  report({ name: '1.3 真Token→200+Array', passed: r3.status === 200 && Array.isArray(data3), error: `status=${r3.status}` });
}

function testWebSocket(token) {
  return new Promise((resolve) => {
    console.log('\n═══ Phase 2: WebSocket 假翻译全链路 ═══\n');
    const ws = new WebSocket(WS);
    let sid = null, count = 0, resolved = false;
    const translations = [];

    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; ws.close(); report({ name: 'WS 超时', passed: false, error: '30s' }); resolve(null); }
    }, 35000);

    ws.on('open', () => {
      report({ name: '2.0 WS连接成功', passed: true });
      ws.send(JSON.stringify({
        type: 'session_start', payload: { token },
        trace_id: crypto.randomUUID(), timestamp_ms: Date.now()
      }));
    });

    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === 'error') {
          report({ name: '服务端报错', passed: false, error: `code=${m.payload.code} ${m.payload.error}` });
          clearTimeout(timer); ws.close(); resolve(null); return;
        }
        if (m.type === 'session_created') {
          sid = m.payload.session_id;
          report({ name: '2.1 session_created', passed: true });
        }
        if (m.type === 'translation') {
          count++;
          translations.push(m.payload);
          console.log(`  📝 #${count}: "${m.payload.text}" [${m.payload.type}] conf=${m.payload.confidence}`);
          report({ name: `翻译#${count}: "${m.payload.text}"`, passed: !!m.payload.text });

          if (translations.some(t => t.type === 'sentence_end') && count >= 4 && !resolved) {
            resolved = true; clearTimeout(timer);
            report({ name: `2.${count+1} 完整序列(sentence_end)`, passed: true });

            ws.send(JSON.stringify({
              type: 'session_end', payload: { session_id: sid },
              trace_id: crypto.randomUUID(), timestamp_ms: Date.now()
            }));

            setTimeout(() => { ws.close(1000); resolve({ sid, translations }); }, 500);
          }
        }
      } catch {}
    });

    ws.on('error', e => { report({ name: 'WS异常', passed: false, error: e.message }); clearTimeout(timer); resolve(null); });
  });
}

async function testDbVerify(token, sid) {
  console.log('\n═══ Phase 3: 数据库持久化验证 ═══\n');
  await new Promise(r => setTimeout(r, 2000));

  const r = await fetch(`${API}/sessions`, { headers: { Authorization: `Bearer ${token}` } });
  const sessions = await r.json();
  const found = sessions.find(s => s.id === sid);
  report({ name: '3.1 会话在DB', passed: !!found });
  if (found) report({ name: '3.2 翻译计数>0', passed: found.translationCount > 0, error: `count=${found.translationCount}` });

  const r2 = await fetch(`${API}/sessions/${sid}/history`, { headers: { Authorization: `Bearer ${token}` } });
  const hist = await r2.json();
  report({ name: '3.3 翻译历史可查', passed: r2.status === 200 && Array.isArray(hist) });
  if (Array.isArray(hist) && hist.length > 0) {
    report({ name: '3.4 记录字段完整', passed: !!hist[0].text && typeof hist[0].confidence === 'number' });
  }
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  HandChat 全链路集成测试            ║');
  console.log('╚══════════════════════════════════════╝');

  try { await fetch(`${API}/sessions`); console.log('✅ 后端可达\n'); }
  catch { console.log('❌ 后端未运行！cd backend && npm run dev'); process.exit(1); }

  const token = await getTokenFromBrowser();
  if (!token) {
    console.log('\n❌ 未能获取JWT Token');
    console.log('请先在 http://localhost:5173 手动登录一次');
    console.log('已保存截图到 tests/login-page.png 供参考');
    process.exit(1);
  }

  await testRestApi(token);

  const wsResult = await testWebSocket(token);

  if (wsResult?.sid) {
    await testDbVerify(token, wsResult.sid);
  }

  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  结果: ${errors.length === 0 ? '✅ 全通过' : `❌ ${errors.length}失败`}                        ║`);
  console.log(`╚══════════════════════════════════════╝`);
  errors.forEach(e => console.log(`  ❌ ${e.name}: ${e.error}`));
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
