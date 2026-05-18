import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf-8').split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const eq = l.indexOf('='); return [l.slice(0, eq), l.slice(eq + 1).replace(/^["']|["']$/g, '')]; })
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

const { data, error } = await supabase.auth.signUp({
  email: 'handchat-dev@example.com',
  password: 'Test123456!',
  options: { data: { name: 'DevTester' } }
});

console.log('data:', JSON.stringify(data, null, 2));
console.log('error:', error?.message || 'none');
if (data?.session) {
  console.log('✅ TOKEN:', data.session.access_token.slice(0, 50) + '...');
} else if (data?.user) {
  console.log('⚠ 用户已创建但需邮箱确认');
  console.log('user id:', data.user.id);
} else {
  console.log('❌ 创建失败');
}
