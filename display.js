const stage = $('#stage'); let D = null, lastHtml = '';
const tn = id => (D.teams.find(t => t.id === id) || {}).display_name || '';
const title = r => (D.qs.find(x => x.round_number === r && x.kind === 'title') || {}).text || '';
const qlist = r => D.qs.filter(x => x.round_number === r && x.kind === 'q').sort((a, b) => a.position - b.position);
const tipq = r => D.qs.find(x => x.round_number === r && x.kind === 'tip');
const clock = () => '<div id="clk"></div>';

async function load() {
  try {
    const { data: zs, error } = await db.from('quizzes').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1);
    if (error) throw error;
    if (!zs[0]) D = null; else {
      const id = zs[0].id, g = t => db.from(t).select('*').eq('quiz_id', id);
      const [t, s, a, q] = await Promise.all([g('teams').order('team_number'), g('round_scores'), g('tip_awards'), g('questions')]);
      if (t.error || s.error || a.error || q.error) throw new Error('db');
      D = { z: zs[0], teams: t.data, scores: s.data, awards: a.data, qs: q.data };
    }
    draw();
  } catch (e) { console.error(e); }   // při výpadku zůstává na plátně poslední známý obsah
}
function board(list, mode) {
  return `<div class="list">${list.map(x => `<div class="row"><span class="k">${x.rank}</span><span class="t">${esc(x.display_name)}</span>${mode ? `<span class="d">${mode(x)}</span>` : ''}<span class="p">${fmt(x.total)}</span></div>`).join('')}</div>`;
}
function html() {
  if (!D) return '<h1>🏆 KVÍZ</h1><div class="big">Čekáme na začátek kvízu…</div>';
  const z = D.z, st = standings(D.teams, D.scores, D.awards); document.body.style.setProperty('--n', st.length);
  if (z.override === 'break') return `<h1>PŘESTÁVKA</h1>${clock()}<div class="sm">Za chvíli pokračujeme</div>`;
  if (z.override === 'rank') return `<h1>🏆 PRŮBĚŽNÉ POŘADÍ</h1>${board(st)}`;
  if (z.override === 'qr' || z.stage === 'setup') return `<h1>Rozřaď se do týmu</h1>${qrSvg(rozUrl())}<div class="sm">Naskenuj QR kód telefonem a stiskni „ROZŘAĎ MNE“</div>`;
  if (z.stage === 'final') return `<h1>KVÍZ DOKONČEN</h1><div class="kick">🏆 KONEČNÉ POŘADÍ</div>${board(st)}`;
  const r = z.round_no, kick = `KOLO ${r}${title(r) ? ' · ' + esc(title(r)) : ''}`;
  if (z.phase === 'q' || z.phase === 'qeval') {
    const l = qlist(r), q = l[z.q_idx]; if (!q) return `<div class="kick">${kick}</div>`;
    return `<div class="kick">${kick} · Otázka ${z.q_idx + 1} / ${l.length}</div><div class="big">${esc(q.text)}</div>${z.phase === 'qeval' && z.shown_answer ? `<div class="ans">${esc(z.shown_answer)}</div>` : ''}`;
  }
  const tq = tipq(r);
  if (z.phase === 'tip') return `<div class="kick">${kick} · TIPOVAČKA</div><div class="big">${esc(tq ? tq.text : '')}</div>`;
  if (z.phase === 'countdown') return `<div class="kick">${kick} · TIPOVAČKA</div><div class="sm" style="margin:0 0 2vh">${esc(tq ? tq.text : '')}</div>${clock()}`;
  if (z.phase === 'tipeval') {
    const v = z.tip_reveal; if (!v) return `<div class="kick">${kick} · TIPOVAČKA</div>`;
    const rows = [...v.rows].sort((a, b) => b.diff - a.diff);   // od největší odchylky po nejmenší
    const w = v.winners.length > 1 ? `Shoda – ${esc(joinCz(v.winners.map(tn)))}` : `Vítěz tipovačky: ${esc(tn(v.winners[0]))}`;
    document.body.style.setProperty('--n', rows.length);
    return `<div class="kick">${kick} · TIPOVAČKA</div><div class="ans" style="margin:0 0 3vh">Správná odpověď: ${fmt(v.correct)}</div><div class="list tipr">${rows.map((x, i) =>
      `<div class="row ${v.winners.includes(x.id) ? 'win' : ''}" style="animation-delay:${i * .5}s"><span class="t">${esc(tn(x.id))}</span><span class="d">${fmt(x.answer)}</span><span class="d">± ${fmt(x.diff)}</span></div>`).join('')}</div>
      <div class="kick" style="margin:2vh 0 0;animation:pop .6s ${rows.length * .5}s both">${w}</div>`;
  }
  const aw = D.awards.find(a => a.round_number === r);   // results
  return `<h1>VÝSLEDKY KOLA ${r}</h1>${board(st, x => `+${fmt(x.per[r])}${aw && aw.team_id === x.id ? ' ⭐' : ''}`)}<div class="sm">⭐ bod za tipovačku · vpravo celkem bodů</div>`;
}
function draw() { const h = html(); if (h !== lastHtml) { lastHtml = h; stage.innerHTML = h; stage.style.animation = 'none'; stage.offsetHeight; stage.style.animation = ''; } tick(); }
function tick() {
  const c = $('#clk'); if (!c || !D) return; const z = D.z, left = timerLeft(z);
  c.textContent = z.timer_state === 'run' && left === 0 ? 'Čas vypršel!' : mmss(left);
  c.className = z.timer_state === 'run' && left === 0 ? 'zero' : z.timer_state === 'run' && left <= 10 ? 'low' : '';
  if (z.timer_state === 'run' && left === 0) c.style.fontSize = '14vh';
}
let tm; const soon = () => { clearTimeout(tm); tm = setTimeout(load, 150); };
(async () => {
  await syncClock(); await load();
  db.channel('disp').on('postgres_changes', { event: '*', schema: 'public' }, soon).subscribe();
  setInterval(tick, 250); setInterval(load, 20000); setInterval(syncClock, 300000);
})();
