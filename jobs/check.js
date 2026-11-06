/* Backend self-test (manual workflow): verifies schema, RLS, anonymous sign-in and the service key. Prints PASS/FAIL only. */
const { createClient } = require('@supabase/supabase-js');
const url = process.env.SUPABASE_URL, pub = process.env.SUPABASE_PUBLISHABLE_KEY, srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
const out = []; const ok = (n, c, d) => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? '  → ' + d : ''}`);
(async () => {
  ok('secret SUPABASE_URL present', !!url); ok('secret SUPABASE_SERVICE_ROLE_KEY present', !!srv);
  if (!url) return;
  const a = createClient(url, pub, { auth: { persistSession: false } });
  const s = await a.auth.signInAnonymously(); ok('anonymous sign-in enabled', !s.error, s.error && s.error.message);
  if (!s.error) {
    const uid = s.data.user.id, pid = 'TEST-' + Date.now();
    let r = await a.from('participants').insert({ id: uid, pid, consent_version: 'selftest' }); ok('participant insert (RLS own row)', !r.error, r.error && r.error.message);
    r = await a.from('habits').insert({ name: 'test', origin_node: 'x', dest_node: 'y', arrive_by: '09:00', usual_departure: '08:00' }); ok('habit insert', !r.error, r.error && r.error.message);
    r = await a.from('participants').select('pid'); ok('participant sees only own row', !r.error && r.data.length === 1, r.error ? r.error.message : 'rows: ' + (r.data || []).length);
    r = await a.from('model_packs').select('version').limit(1); ok('model_packs readable', !r.error, r.error && r.error.message);
    r = await a.from('sent_alerts').select('*').limit(1); ok('sent_alerts hidden from clients', !!r.error || (r.data || []).length === 0);
    r = await a.rpc('delete_my_data'); ok('delete_my_data (right to erasure)', !r.error, r.error && r.error.message);
  }
  if (srv) {
    const b = createClient(url, srv, { auth: { persistSession: false } });
    for (const t of ['participants', 'habits', 'trips', 'segment_observations', 'reports', 'push_subscriptions', 'model_packs', 'sent_alerts']) {
      const r = await b.from(t).select('*', { count: 'exact', head: true }); ok('table ' + t, !r.error, r.error && (r.error.code + ' ' + (r.error.message || r.status)));
    }
  }
})().catch(e => ok('unexpected', false, e.message)).finally(() => { console.log(out.join('\n')); if (out.some(l => l.startsWith('FAIL'))) process.exit(1); });
