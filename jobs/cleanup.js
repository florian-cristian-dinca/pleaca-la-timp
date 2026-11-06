/* Manual maintenance: lists participants (counts only) and, with DELETE_IDS set, removes the given test participants
   (cascade deletes their habits, trips, segment times, reports, subscriptions). Prints no codes, places or times of day. */
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const q = async (t, c = '*') => { const { data, error } = await db.from(t).select(c); if (error) throw new Error(t + ': ' + error.message); return data || []; };
  const [P, T, S, H, U] = await Promise.all([q('participants'), q('trips', 'participant,dep_min,dur_min'), q('segment_observations', 'participant'), q('habits', 'participant'), q('push_subscriptions', 'participant')]);
  const del = (process.env.DELETE_IDS || '').split(',').filter(Boolean);
  P.sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach((p, i) => {
    const tr = T.filter(t => t.participant === p.id);
    console.log(`#${i + 1} ${p.id.slice(0, 8)} created ${p.created_at.slice(0, 16)}Z consent ${p.consent_version} · habits ${H.filter(h => h.participant === p.id).length} · trips ${tr.length} (late-evening ${tr.filter(t => t.dep_min >= 1260).length}) · segment times ${S.filter(s => s.participant === p.id).length} · push ${U.filter(u => u.participant === p.id).length}`);
  });
  for (const id of del) {
    const p = P.find(x => x.id.startsWith(id)); if (!p) { console.log('not found', id); continue; }
    const { error } = await db.auth.admin.deleteUser(p.id); console.log('deleted', id, error ? error.message : 'ok');
  }
})().catch(e => { console.error(e.message); process.exit(1); });
