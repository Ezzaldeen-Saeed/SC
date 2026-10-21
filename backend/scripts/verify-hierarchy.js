/**
 * verify-hierarchy.js — اختبار حيّ للهرمية والصلاحيات على قاعدة البيانات.
 *
 * ⚠️ شغّله بعد تطبيق supabase/migrate.sql (يستخدم العمود parent_id).
 * التشغيل:   cd backend && node scripts/verify-hierarchy.js
 *
 * يبني شجرة تجريبية، يستدعي خدمات الكود الفعلية، يتأكد من العزل بين الأدوار،
 * ثم يمسح كل البيانات التجريبية. لا يترك أي أثر.
 */

const usersService = require('../src/services/users.service');
const callsService = require('../src/services/calls.service');
const dashboardService = require('../src/services/dashboard.service');
const { supabaseAdmin } = require('../src/config/supabase');

const made = { users: [] };
let seq = 0;
const uniq = () => `${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

async function mkUser(role, parent, label) {
  const u = uniq();
  const { data, error } = await supabaseAdmin.from('users')
    .insert({ full_name: `__T ${label}`, username: `__t_${u}`, email: `__t_${u}@test.local`, role, parent_id: parent || null, is_active: true })
    .select('user_id').single();
  if (error) throw new Error(`mkUser ${label}: ${error.message}`);
  made.users.push(data.user_id);
  return data.user_id;
}
async function mkScoredCall(user_id, total) {
  const now = new Date(), s = new Date(now - 20000);
  const ins = await supabaseAdmin.from('calls')
    .insert({ user_id, call_start: s.toISOString(), call_end: now.toISOString(), duration: '20 seconds', call_type: 'inquiry', issues_category: '__t' })
    .select('call_id').single();
  if (ins.error) throw new Error('mkCall: ' + ins.error.message);
  await supabaseAdmin.from('performance_scores').insert({ call_id: ins.data.call_id, total_score: total });
}

let pass = 0, fail = 0;
const is = (n, c) => { console.log((c ? '✅' : '❌') + ' ' + n); c ? pass++ : fail++; };
const eqSet = (n, got, exp) => { const g = [...new Set(got)].sort(), e = [...new Set(exp)].sort(); is(n, g.length === e.length && g.every((v, i) => v === e[i])); };
const ok = async (n, fn) => { try { await fn(); is(n, true); } catch (e) { console.log('❌ ' + n + ' (رمى: ' + e.message + ')'); fail++; } };
const reject = async (n, fn) => { try { await fn(); console.log('❌ ' + n + ' (المفروض يُرفض)'); fail++; } catch { is(n, true); } };

(async () => {
  try {
    const mA = await mkUser('manager', null, 'MgrA'), mB = await mkUser('manager', null, 'MgrB');
    const s1 = await mkUser('supervisor', mA, 'Sup1'), s2 = await mkUser('supervisor', mA, 'Sup2'), s3 = await mkUser('supervisor', mB, 'Sup3');
    const a1 = await mkUser('agent', s1, 'A1'), a2 = await mkUser('agent', s1, 'A2');
    const a3 = await mkUser('agent', s2, 'A3'), a4 = await mkUser('agent', s2, 'A4'), a5 = await mkUser('agent', s3, 'A5');
    const aX = await mkUser('agent', s1, 'AX'), sX = await mkUser('supervisor', mA, 'SX');

    console.log('\n── getVisibleAgentIds (الاجتياز) ──');
    eqSet('Manager A → A1..A4', await usersService.getVisibleAgentIds({ id: mA, role: 'manager' }), [a1, a2, a3, a4, aX]);
    eqSet('Manager B → A5', await usersService.getVisibleAgentIds({ id: mB, role: 'manager' }), [a5]);
    eqSet('Supervisor 1 → A1,A2,AX', await usersService.getVisibleAgentIds({ id: s1, role: 'supervisor' }), [a1, a2, aX]);
    eqSet('Supervisor 2 → A3,A4', await usersService.getVisibleAgentIds({ id: s2, role: 'supervisor' }), [a3, a4]);
    eqSet('Agent A1 → نفسه', await usersService.getVisibleAgentIds({ id: a1, role: 'agent' }), [a1]);

    console.log('\n── فرض الهرمية ──');
    await ok('Agent → Supervisor مسموح', () => usersService.assignParent(aX, s1));
    await reject('Agent → Manager مرفوض', () => usersService.assignParent(aX, mA));
    await reject('Agent → بدون أب مرفوض', () => usersService.assignParent(aX, null));
    await ok('Supervisor → Manager مسموح', () => usersService.assignParent(sX, mA));
    await reject('Supervisor → Agent مرفوض', () => usersService.assignParent(sX, a1));

    console.log('\n── عزل المكالمات + KPIs ──');
    await mkScoredCall(a1, 80); await mkScoredCall(a1, 90); await mkScoredCall(a2, 70); await mkScoredCall(a5, 50);
    const mgrACalls = await callsService.getCallsByUserIds(await usersService.getVisibleAgentIds({ id: mA, role: 'manager' }));
    is('Manager A لا يرى مكالمة A5 (وحدة B)', !mgrACalls.some(c => c.user_id === a5));
    const kpis = await dashboardService.getSupervisorKpis(mA);
    is('Manager A KPIs لا تحتوي Sup3 (تبع B)', !kpis.some(k => k.supervisor.user_id === s3));
    const sup1 = kpis.find(k => k.supervisor.user_id === s1);
    is('Sup1 avgScore = 80', sup1 && sup1.avgScore === 80);

    console.log(`\n══════ ${pass} ✅ / ${fail} ❌ ══════`);
  } catch (e) {
    console.log('❌ EXCEPTION:', e.message); fail++;
  } finally {
    if (made.users.length) {
      await supabaseAdmin.from('calls').delete().in('user_id', made.users);
      await supabaseAdmin.from('users').update({ parent_id: null }).in('user_id', made.users);
      await supabaseAdmin.from('users').delete().in('user_id', made.users);
      console.log(`🧹 اتمسح ${made.users.length} مستخدم تجريبي`);
    }
    process.exit(fail ? 1 : 0);
  }
})();
