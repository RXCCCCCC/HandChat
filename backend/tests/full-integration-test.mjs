import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const eq = line.indexOf('=');
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1).replace(/^["']|["']$/g, '');
      return [key, value];
    })
);

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
const WS_URL = 'ws://localhost:3001';
const API_BASE = 'http://localhost:3001/api';

const TEST_EMAIL = `handchat-dev-test@handchat.test`;
const TEST_PASSWORD = 'Test123456!';
const TEST_NAME = 'TestBot';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let sessionId = null;
let accessToken = null;
let userId = null;
let translationCount = 0;
const errors = [];

function log(title, detail = '') {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${title}`, detail ? `→ ${detail}` : '');
}

function genTraceId() {
  return crypto.randomUUID();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function report(result) {
  const symbol = result.passed ? '✅' : '❌';
  if (result.passed) {
    console.log(`  ${symbol} ${result.name}`);
  } else {
    console.log(`  ${symbol} ${result.name} — ${result.error}`);
    errors.push(result);
  }
}

// ════════════════════════════════════════════════════════════
// Phase 1: Auth — sign up test user
// ════════════════════════════════════════════════════════════
async function phaseAuth() {
  console.log('\n═══ Phase 1: 认证 — 注册/登录测试用户 ═══\n');

  // 1.1 Try sign in first
  log('尝试登录', TEST_EMAIL);
  let { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (signInData?.session) {
    accessToken = signInData.session.access_token;
    userId = signInData.session.user.id;
    report({ name: '1.1 登录已有测试用户', passed: true });
    return;
  }

  // 1.2 Sign up new user
  log('注册新用户', TEST_EMAIL);
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    options: { data: { name: TEST_NAME } },
  });

  if (signUpError) {
    report({ name: '1.2 注册测试用户', passed: false, error: signUpError.message });
    return false;
  }

  if (signUpData.session) {
    accessToken = signUpData.session.access_token;
    userId = signUpData.session.user.id;
    report({ name: '1.2 注册+自动登录测试用户', passed: true });
    return true;
  }

  // Email confirmation required
  report({
    name: '1.2 注册测试用户',
    passed: false,
    error: '需要邮箱确认。请在 Supabase Dashboard → Authentication → Settings → 关闭 "Confirm email" 后重试'
  });
  return false;
}

// ════════════════════════════════════════════════════════════
// Phase 2: REST API
// ════════════════════════════════════════════════════════════
async function phaseRestApi() {
  console.log('\n═══ Phase 2: REST API 验证 ═══\n');

  // 2.1 Unauthenticated request → 401
  log('GET /api/sessions (无 Token)');
  const res1 = await fetch(`${API_BASE}/sessions`);
  report({
    name: '2.1 无 Token 返回 401',
    passed: res1.status === 401,
    error: res1.status === 401 ? '' : `Got ${res1.status}`
  });

  // 2.2 Invalid token → 401
  log('GET /api/sessions (假 Token)');
  const res2 = await fetch(`${API_BASE}/sessions`, {
    headers: { Authorization: 'Bearer fake-token-12345' }
  });
  report({
    name: '2.2 假 Token 返回 401',
    passed: res2.status === 401,
    error: res2.status === 401 ? '' : `Got ${res2.status}`
  });

  // 2.3 Valid token → 200
  log('GET /api/sessions (真实 Token)');
  const res3 = await fetch(`${API_BASE}/sessions`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const sessions = await res3.json().catch(() => null);
  report({
    name: '2.3 真实 Token 返回 200',
    passed: res3.status === 200 && Array.isArray(sessions),
    error: `Status=${res3.status}, isArray=${Array.isArray(sessions)}`
  });

  return Array.isArray(sessions);
}

// ════════════════════════════════════════════════════════════
// Phase 3: WebSocket — session_start → session_created
// ════════════════════════════════════════════════════════════
function phaseWebSocket() {
  return new Promise((resolve, reject) => {
    console.log('\n═══ Phase 3: WebSocket 验证 ═══\n');

    log('连接', WS_URL);
    const ws = new WebSocket(WS_URL);
    let receivedSessionCreated = false;
    const receivedTranslations = [];
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        report({ name: '3.1 session_start → session_created', passed: false, error: '超时未收到 session_created' });
        reject(new Error('WebSocket 测试超时'));
      }
    }, 15000);

    ws.on('open', () => {
      log('WS 已连接');
      report({ name: '3.0 WebSocket 连接建立', passed: true });

      log('发送 session_start');
      ws.send(JSON.stringify({
        type: 'session_start',
        payload: { token: accessToken },
        trace_id: genTraceId(),
        timestamp_ms: Date.now(),
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        log('收到', msg.type);

        if (msg.type === 'session_created') {
          receivedSessionCreated = true;
          sessionId = msg.payload.session_id;
          log('Session ID', sessionId);
          report({ name: '3.1 session_start → session_created', passed: true });

        } else if (msg.type === 'translation') {
          translationCount++;
          receivedTranslations.push({
            text: msg.payload.text,
            type: msg.payload.type,
            confidence: msg.payload.confidence,
          });
          log(`  翻译 #${translationCount}`, `"${msg.payload.text}" [${msg.payload.type}] conf=${msg.payload.confidence}`);

          report({
            name: `3.${translationCount + 1} 假翻译消息 #${translationCount}: "${msg.payload.text}"`,
            passed: msg.payload.text.length > 0 && msg.payload.confidence > 0,
            error: msg.payload.text.length === 0 ? 'text为空' : ''
          });

          // After receiving 4 translations (including sentence_end), end session
          if (translationCount >= 4 && !resolved) {
            resolved = true;
            clearTimeout(timeout);

            // Check we got sentence_end
            const hasSentenceEnd = receivedTranslations.some(t => t.type === 'sentence_end');
            report({
              name: '3.5 假翻译完整序列（含 sentence_end）',
              passed: hasSentenceEnd && translationCount >= 4,
              error: hasSentenceEnd ? '' : '缺少 sentence_end'
            });

            // Phase 4: session_end
            log('发送 session_end', sessionId);
            ws.send(JSON.stringify({
              type: 'session_end',
              payload: { session_id: sessionId },
              trace_id: genTraceId(),
              timestamp_ms: Date.now(),
            }));

            setTimeout(() => {
              ws.close(1000, 'Test complete');
              resolve({
                sessionId,
                translations: receivedTranslations,
                translationCount,
              });
            }, 1000);
          }

        } else if (msg.type === 'error') {
          report({
            name: '3.X 服务端错误',
            passed: false,
            error: `Code=${msg.payload.code}, Message="${msg.payload.error}"`
          });
        }

      } catch (e) {
        log('解析错误', e.message);
      }
    });

    ws.on('close', (code, reason) => {
      log('WS 关闭', `Code=${code} Reason="${reason}"`);
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        report({
          name: '3.X WebSocket 连接',
          passed: false,
          error: `意外关闭, code=${code}`
        });
        reject(new Error(`WebSocket closed unexpectedly: ${code}`));
      }
    });

    ws.on('error', (err) => {
      log('WS 错误', err.message);
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        report({ name: '3.0 WebSocket 连接', passed: false, error: err.message });
        reject(err);
      }
    });
  });
}

// ════════════════════════════════════════════════════════════
// Phase 4: REST API — verify session in DB
// ════════════════════════════════════════════════════════════
async function phaseRestVerify(sessionIdFromWs) {
  console.log('\n═══ Phase 4: REST API — 数据库验证 ═══\n');

  log('GET /api/sessions (会话列表)');
  const res = await fetch(`${API_BASE}/sessions`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const sessions = await res.json();

  const foundSession = sessions.find(s => s.id === sessionIdFromWs);
  report({
    name: '4.1 会话已写入数据库',
    passed: !!foundSession,
    error: foundSession ? '' : `Session ${sessionIdFromWs} not found in /api/sessions`
  });

  if (foundSession) {
    report({
      name: '4.2 会话状态为 active 或 ended',
      passed: ['active', 'ended'].includes(foundSession.status),
      error: `status=${foundSession.status}`
    });

    report({
      name: '4.3 会话翻译计数 > 0',
      passed: foundSession.translationCount > 0,
      error: `translationCount=${foundSession.translationCount}`
    });
  }

  // Check translation history
  if (foundSession) {
    log('GET /api/sessions/:id/history');
    const res2 = await fetch(`${API_BASE}/sessions/${sessionIdFromWs}/history`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const history = await res2.json();

    report({
      name: '4.4 翻译历史可查询',
      passed: res2.status === 200 && Array.isArray(history),
      error: `Status=${res2.status}, isArray=${Array.isArray(history)}`
    });

    if (Array.isArray(history) && history.length > 0) {
      const sample = history[0];
      report({
        name: '4.5 翻译记录字段完整',
        passed: !!sample.text && typeof sample.confidence === 'number' && !!sample.type,
        error: !sample.text ? '缺少text' : ''
      });
    }
  }
}

// ════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   HandChat 全链路集成测试                  ║');
  console.log(`║   ${new Date().toISOString()}                 ║`);
  console.log('╚══════════════════════════════════════════════╝');

  // Check server
  log('检查后端服务', API_BASE);
  try {
    const health = await fetch(`${API_BASE}/sessions`);
    log('后端可达', `Status=${health.status}`);
  } catch {
    console.error('❌ 后端服务未运行! 请先执行: cd backend && npm run dev');
    process.exit(1);
  }

  // Phase 1
  const authOk = await phaseAuth();
  if (!authOk) {
    console.log('\n❌ 认证阶段失败，终止测试');
    console.log('请确保 Supabase 项目中 "Confirm email" 已关闭');
    return;
  }

  // Phase 2
  await phaseRestApi();

  // Phase 3
  let wsResult;
  try {
    wsResult = await phaseWebSocket();
  } catch (e) {
    console.error('WebSocket 测试异常:', e.message);
  }

  // Phase 4
  if (wsResult?.sessionId) {
    await sleep(2000); // Wait for DB write
    await phaseRestVerify(wsResult.sessionId);
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log(`║   测试总结: ${errors.length === 0 ? '✅ 全部通过' : `❌ ${errors.length} 个失败`}              ║`);
  console.log('╚══════════════════════════════════════════════╝');

  if (errors.length > 0) {
    console.log('\n失败项:');
    errors.forEach(e => console.log(`  ❌ ${e.name}: ${e.error}`));
    process.exit(1);
  }
}

main().catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
