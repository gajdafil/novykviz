const S = { tab: 'sort', authed: false, quiz: null, teams: [], players: [], scores: [], awards: [], qs: [], ans: [], tipAns: [], tipRound: 1, scoreRound: null, last: null, tm: 2, bm: 10, txt: '', parsed: null };
const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
const tname = id => (S.teams.find(t => t.id === id) || {}).display_name || '';
const qsOf = (r, k) => S.qs.filter(x => x.round_number === r && x.kind === k).sort((a, b) => a.position - b.position);
const ansOf = id => (S.ans.find(a => a.question_id === id) || {}).answer;

function toast(t, ok = false) { const el = $('#toast'); el.textContent = t; el.style.background = ok ? 'var(--ok)' : 'var(--err)'; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = 'none', 3500); }
async function act(fn) {
  try { await fn(); $('#banner').hidden = true; }
  catch (e) { console.error(e); toast('Připojení k serveru bylo ztraceno. Změny nebyly potvrzeny.'); }
}
function confirmDlg(text, yes, fn) { $('#dlgq').textContent = text; $('#dlgy').textContent = yes; $('#dlgy').onclick = () => { $('#dlg').close(); fn(); }; $('#dlg').showModal(); }
window.addEventListener('offline', () => $('#banner').hidden = false);
window.addEventListener('online', () => { $('#banner').hidden = true; act(load); });

async function load() {
  const z = await q(db.from('quizzes').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1));
  S.quiz = z[0] || null;
  if (S.quiz) {
    const g = t => db.from(t).select('*').eq('quiz_id', S.quiz.id);
    [S.teams, S.players, S.scores, S.awards, S.qs, S.ans, S.tipAns] = await Promise.all([g('teams').order('team_number').then(r => r.data), g('players').order('player_number').then(r => r.data),
      g('round_scores').then(r => r.data), g('tip_awards').then(r => r.data), g('questions').then(r => r.data), g('answers').then(r => r.data), g('tip_answers').then(r => r.data)]);
    if (!S.scoreRound) S.scoreRound = S.quiz.round_no;
  }
  render();
}
const upd = o => act(async () => { await q(db.from('quizzes').update(o).eq('id', S.quiz.id)); await load(); });

function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === S.tab));
  $('#hdr').innerHTML = S.quiz ? '<button class="gold" style="padding:6px 12px;min-height:36px" onclick="askNew()">Nový kvíz</button>' : '';
  $('#app').innerHTML = !S.authed ? viewLogin() : !S.quiz ? viewNew() : panel() + { sort: viewSort, tip: viewTip, res: viewRes }[S.tab]();
  tickM();
}

/* ---------- přihlášení, nový kvíz ---------- */
const viewLogin = () => `<div class="card"><h2>Přihlášení moderátora</h2><label>E-mail</label><input id="em" type="email" autocomplete="username"><label>Heslo</label><input id="pw" type="password" autocomplete="current-password"><p></p><button onclick="login()">Přihlásit se</button></div>`;
async function login() {
  const { error } = await db.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
  if (error) return toast('Přihlášení se nezdařilo. Zkontrolujte e-mail a heslo.');
  S.authed = true; act(async () => { await syncClock(); await load(); });
}
const viewNew = () => `<div class="card"><h2>NOVÝ KVÍZ</h2><label>Počet týmů</label><input id="tc" inputmode="numeric" placeholder="např. 4"><p></p><button class="gold" onclick="createQuiz()">Vytvořit kvíz</button></div>`;
function createQuiz() {
  const n = num($('#tc').value);
  if ($('#tc').value.trim() === '') return toast('Zadejte počet týmů.');
  if (n === null || !Number.isInteger(n) || n < 2 || n > 20) return toast('Počet týmů musí být celé číslo od 2 do 20.');
  act(async () => {
    await q(db.from('quizzes').update({ active: false }).eq('active', true));
    const [z] = await q(db.from('quizzes').insert({ team_count: n }).select());
    await q(db.from('teams').insert(Array.from({ length: n }, (_, i) => ({ quiz_id: z.id, team_number: i + 1, display_name: 'Tým ' + (i + 1) }))));
    Object.assign(S, { tipRound: 1, scoreRound: null, last: null, tab: 'sort', parsed: null, txt: '' }); await load(); toast(`Kvíz je připraven: ${n} týmů, 5 kol`, true);
  });
}
const askNew = () => confirmDlg('Opravdu chcete začít nový kvíz? Tím se smaže aktuální rozřazení, otázky, body a výsledky.', 'Ano, nový kvíz', () =>
  act(async () => { await q(db.from('quizzes').update({ active: false }).eq('active', true)); S.quiz = null; S.scoreRound = null; render(); }));

/* ---------- stavový automat kola ---------- */
const subOf = (r, k) => { const L = qsOf(r, 'q'); return qsOf(r, 'sub').filter(x => x.position <= L[k].position).pop(); };
function steps(r) {   // před první otázkou každého podokruhu je samostatný snímek s jeho názvem (v obou částech kola)
  const L = qsOf(r, 'q'), subs = qsOf(r, 'sub'), a = [], head = k => subs.some(s => s.position === L[k].position);
  L.forEach((x, k) => { if (head(k)) a.push({ phase: 'sub', i: k }); a.push({ phase: 'q', i: k }); });
  a.push({ phase: 'tip', i: 0 }, { phase: 'countdown', i: 0 });
  L.forEach((x, k) => { if (head(k)) a.push({ phase: 'subeval', i: k }); a.push({ phase: 'qeval', i: k }); });
  a.push({ phase: 'tipeval', i: 0 }, { phase: 'results', i: 0 });
  return a;
}
const label = s => { const nm = () => (subOf(S.quiz.round_no, s.i) || {}).text || ''; return ({ sub: `Podokruh: ${nm()}`, subeval: `Podokruh: ${nm()} (vyhodnocení)`, q: `Otázka ${s.i + 1} (bez odpovědi)`, tip: 'Tipovačka – zadání', countdown: 'Odpočet', qeval: `Vyhodnocení otázky ${s.i + 1}`, tipeval: 'Vyhodnocení tipovačky', results: 'Výsledky kola' })[s.phase]; };
const pos = () => Math.max(0, steps(S.quiz.round_no).findIndex(s => s.phase === S.quiz.phase && s.i === S.quiz.q_idx));
const tipCalcFor = r => {
  const rows = S.tipAns.filter(x => x.round_number === r);
  return rows.length && rows.length === S.teams.length ? tipCalc(Number(rows[0].correct), rows.map(x => ({ id: x.team_id, a: Number(x.answer) }))) : null;
};
function target(r, s) {   // veřejná data pro daný krok; správná odpověď jen ve fázích vyhodnocení
  const o = { stage: 'round', round_no: r, phase: s.phase, q_idx: s.i, shown_answer: null, tip_reveal: null };
  if (s.phase === 'qeval') o.shown_answer = ansOf((qsOf(r, 'q')[s.i] || {}).id) ?? null;
  if (s.phase === 'tipeval') { const c = tipCalcFor(r); o.tip_reveal = { correct: c.correct, rows: c.rows, winners: c.winners }; }
  if (s.phase === 'countdown') Object.assign(o, { timer_state: 'idle', timer_total: Math.round(S.tm * 60) });
  return o;
}
function go(d) {
  const z = S.quiz, r = z.round_no, st = steps(r), p = pos(), n = p + d;
  if (n < 0) { if (r === 1) return; const pr = steps(r - 1); return upd(target(r - 1, pr[pr.length - 1])); }
  if (n >= st.length) {
    if (r === 5) return confirmDlg('Ukončit kvíz a zobrazit konečné pořadí?', 'Ano, ukončit', () => upd({ stage: 'final', override: null, shown_answer: null, tip_reveal: null }));
    return upd({ ...target(r + 1, steps(r + 1)[0]), override: null });
  }
  const s = st[n];
  if (d > 0 && s.phase === 'tipeval' && !tipCalcFor(r)) return toast('Nejprve vyplňte a vyhodnoťte tipovačku v záložce Tipovačka.');
  if (d > 0 && s.phase === 'qeval' && ansOf((qsOf(r, 'q')[s.i] || {}).id) === undefined) return toast('Chybí správné odpovědi – importujte otázky z TXT.');
  const run = () => upd(target(r, s));
  if (d > 0 && z.phase === 'countdown' && !(z.timer_state === 'run' && timerLeft(z) === 0)) return confirmDlg('Odpočet ještě neskončil nebo nebyl spuštěn. Přesto přejít na vyhodnocení?', 'Ano, pokračovat', run);
  run();
}
const startQuiz = () => upd(target(1, steps(1)[0]));
const setOv = o => upd(o === null && S.quiz.override === 'break' ? { override: null, timer_state: 'idle' } : { override: o });

/* odpočet */
const sec = m => Math.round(Number(String(m).replace(',', '.')) * 60);
function tStart(total) { if (!(total > 0)) return toast('Zadejte platnou délku v minutách.'); upd({ timer_total: total, timer_end: new Date(now() + total * 1000).toISOString(), timer_state: 'run' }); }
const tPause = () => upd({ timer_state: 'pause', timer_left: timerLeft(S.quiz) });
const tResume = () => upd({ timer_state: 'run', timer_end: new Date(now() + S.quiz.timer_left * 1000).toISOString() });
const tStop = () => upd({ timer_state: 'idle' });
const tReset = () => { const f = () => upd({ timer_state: 'idle', timer_total: S.quiz.override === 'break' ? sec(S.bm) : sec(S.tm) }); S.quiz.timer_state === 'run' ? confirmDlg('Odpočet právě běží. Opravdu ho resetovat?', 'Ano, resetovat', f) : f(); };
function timerCtl(len, key) {
  const z = S.quiz, st = z.timer_state;
  return `<div class="mclk" id="mclk"></div><label>Délka (minuty)</label><input value="${S[key]}" inputmode="decimal" onchange="S.${key}=this.value">
  <div class="row2">${st === 'run' ? '<button onclick="tPause()">Pozastavit</button>' : st === 'pause' ? '<button onclick="tResume()">Pokračovat</button>' : `<button class="gold" onclick="tStart(sec(S.${key}))">Spustit odpočet</button>`}
  <button class="ghost" onclick="tStop()">Zastavit</button><button class="ghost" onclick="tReset()">Reset</button></div>`;
}
const tickM = () => { const e = $('#mclk'); if (e && S.quiz) e.textContent = mmss(timerLeft(S.quiz)); };
setInterval(tickM, 500);
function startBreak() { const t = sec(S.bm); if (!(t > 0)) return toast('Zadejte platnou délku přestávky.'); upd({ override: 'break', timer_total: t, timer_end: new Date(now() + t * 1000).toISOString(), timer_state: 'run' }); }

function panel() {
  const z = S.quiz; let h = '<div class="card pn">';
  if (z.override === 'break') h += `<b>Na plátně: PŘESTÁVKA</b>${timerCtl(0, 'bm')}<p></p><button class="gold" onclick="setOv(null)">Ukončit přestávku</button>`;
  else if (z.override) h += `<b>Na plátně: ${z.override === 'rank' ? 'pořadí' : 'QR kód'}</b><p></p><button class="gold" onclick="setOv(null)">Zpět do kvízu</button>`;
  else {
    if (z.stage === 'setup') h += '<b>Rozřazování hráčů</b><p></p><button class="gold" onclick="startQuiz()">Zahájit kolo 1</button>';
    else if (z.stage === 'final') h += '<div class="done">KVÍZ DOKONČEN</div>';
    else h += `<b>Kolo ${z.round_no} · ${label(steps(z.round_no)[pos()])}</b><div class="nav2"><button class="ghost" onclick="go(-1)">◀ Zpět</button><button class="gold" onclick="go(1)">Další ▶</button></div>${z.phase === 'countdown' ? timerCtl(0, 'tm') : ''}`;
    h += `<div class="row2"><button class="ghost" onclick="setOv('qr')">QR na plátno</button><button class="ghost" onclick="setOv('rank')">Pořadí</button><button class="ghost" onclick="startBreak()">Přestávka</button></div>
      <label class="sm">Délka přestávky (min)</label><input value="${S.bm}" inputmode="decimal" onchange="S.bm=this.value">`;
  }
  return h + `<div class="sm">${$('#banner').hidden ? 'Připojeno' : 'Bez spojení'}</div></div>`;
}

/* ---------- 1. Rozřazení ---------- */
function viewSort() {
  const z = S.quiz, T = S.teams.length, P = z.player_count, n = S.players.length;
  let h = `<div class="card"><b>✓ Kvíz je připraven</b><br>${T} týmů · 5 kol</div>`;
  h += `<div class="card"><h2>ROZŘAZENÍ</h2><p>Počet týmů: <b>${T}</b></p><label>Počet hráčů</label><input id="pc" inputmode="numeric" value="${P ?? ''}" placeholder="např. 10"><p></p><button class="gold" onclick="setPlayers()">Uložit počet hráčů</button>`;
  if (P) h += `<p><b>Rozřazeno: ${n} / ${P} hráčů</b></p>${n >= P ? '<p class="res">✓ Všichni hráči jsou rozřazeni.</p>' : ''}${S.last ? `<p class="res">Jsi v týmu ${esc(short(S.last.name))} 🎉 (Hráč ${S.last.player})</p>` : ''}<button class="ghost" ${n >= P ? 'disabled' : ''} onclick="allocHere()">Rozřadit hráče na tomto telefonu</button>`;
  h += `</div><div class="card qr"><b>QR kód pro hráče</b>${qrSvg(rozUrl())}<div class="sm" style="word-break:break-all">${esc(rozUrl())}</div><p></p><button class="ghost" onclick="setOv('qr')">Zobrazit QR na plátně</button></div>`;
  h += `<div class="card"><table>${S.teams.map(t => `<tr><td>${esc(t.display_name)}</td><td class="n">${S.players.filter(p => p.team_id === t.id).length} hráčů</td></tr>`).join('')}</table></div>`;
  if (n) h += `<div class="card"><table><tr><th>Hráč</th><th>Tým</th></tr>${[...S.players].reverse().map(p => `<tr><td>Hráč ${p.player_number}</td><td>${esc(tname(p.team_id))}</td></tr>`).join('')}</table></div>`;
  return h;
}
function setPlayers() {
  const v = $('#pc').value.trim(), n = num(v);
  if (v === '') return toast('Zadejte počet hráčů.');
  if (n === null || !Number.isInteger(n)) return toast('Zadejte platné číslo.');
  if (n < 1) return toast('Počet hráčů musí být alespoň 1.');
  if (n < S.players.length) return toast(`Už je rozřazeno ${S.players.length} hráčů, počet nelze snížit pod tuto hodnotu.`);
  upd({ player_count: n });
}
const allocHere = () => act(async () => {
  const { data, error } = await db.rpc('assign_player');
  if (error) { await load(); return toast(error.message.includes('FULL') ? 'Všichni hráči jsou již rozřazeni.' : 'Rozřazení se nezdařilo.'); }
  S.last = data; await load();
});

/* ---------- 2. Tipovačka (+ import otázek) ---------- */
function importCard() {
  const P = S.parsed;
  let h = `<details class="card"><summary><b>Načíst otázky z TXT</b>${S.qs.length ? ` (uloženo: ${S.qs.filter(x => x.kind === 'q').length} otázek)` : ''}</summary>
  <p class="sm">Formát: KOLO 1: Název / OTÁZKA 1 / text / ODPOVĚĎ: … / TIPOVAČKA / text / SPRÁVNÁ ODPOVĚĎ: číslo</p>
  <input type="file" accept=".txt,text/plain" onchange="readFile(this.files[0])"><label>Obsah (lze upravit)</label><textarea id="itxt">${esc(S.txt)}</textarea><p></p><button class="gold" onclick="checkImport()">Zkontrolovat import</button>`;
  if (P) {
    h += P.errors.length ? `<p class="err">Nalezeno ${P.errors.length} chyb(y) – import není možný:</p><ul>${P.errors.map(e => `<li class="err">${esc(e)}</li>`).join('')}</ul>`
      : `<p class="res">Rozpoznáno ${P.rounds.length} kol, ${P.rounds.length * 2} podokruhů, ${qcount(P)} klasických otázek a ${P.rounds.length} tipovaček.</p><button onclick="askImport()">Potvrdit import</button>`;
    if (P.warnings.length) h += `<p><b>Upozornění:</b></p><ul>${P.warnings.map(e => `<li class="sm">${esc(e)}</li>`).join('')}</ul>`;
    h += P.rounds.map(r => `<p><b>Kolo ${r.n}</b></p>${r.subs.map(s => `<p><i>Podokruh: ${esc(s.title)}</i></p><ol class="sm">${s.qs.map(x => `<li>${esc(x.text)} → <b style="white-space:pre-line">${esc(x.ans ?? '?')}</b></li>`).join('')}</ol>`).join('')}<p class="sm">Tip: ${esc((r.tips[0] || {}).text)} → <b>${esc((r.tips[0] || {}).ans ?? '?')}</b></p>`).join('');
  }
  return h + '</details>';
}
function readFile(f) { if (!f) return; const r = new FileReader(); r.onload = () => { S.txt = r.result; S.parsed = null; render(); }; r.readAsText(f, 'UTF-8'); }
function checkImport() { S.txt = $('#itxt').value; S.parsed = S.txt.trim() ? parseTxt(S.txt) : { rounds: [], errors: ['Zadejte nebo načtěte text s otázkami.'] }; document.activeElement.blur(); render(); }
const askImport = () => S.qs.length ? confirmDlg('V kvízu už jsou uloženy otázky. Import je nahradí.', 'Ano, nahradit', runImport) : runImport();
function runImport() {
  const P = S.parsed; if (!P || P.errors.length) return;
  act(async () => {
    await q(db.from('questions').delete().eq('quiz_id', S.quiz.id));
    const rows = [], key = (r, k, p) => `${r}|${k}|${p}`, A = {};
    P.rounds.forEach(r => {
      let pos = 0;
      r.subs.forEach(sb => {
        rows.push({ quiz_id: S.quiz.id, round_number: r.n, kind: 'sub', position: pos + 1, text: sb.title });   // název podokruhu stojí před svou první otázkou
        sb.qs.forEach(x => { pos++; rows.push({ quiz_id: S.quiz.id, round_number: r.n, kind: 'q', position: pos, text: x.text }); A[key(r.n, 'q', pos)] = x.ans; });
      });
      r.tips.forEach(x => { rows.push({ quiz_id: S.quiz.id, round_number: r.n, kind: 'tip', position: 0, text: x.text }); A[key(r.n, 'tip', 0)] = String(num(x.ans)); });
    });
    const ins = await q(db.from('questions').insert(rows).select());
    await q(db.from('answers').insert(ins.filter(x => x.kind !== 'sub').map(x => ({ question_id: x.id, quiz_id: S.quiz.id, answer: A[key(x.round_number, x.kind, x.position)] }))));
    S.parsed = null; S.txt = ''; await load(); toast(`✓ Načteno ${P.rounds.length} kol a ${qcount(P)} otázek`, true);
  });
}
function viewTip() {
  const r = S.tipRound, rows = S.tipAns.filter(x => x.round_number === r), tq = qsOf(r, 'tip')[0], c = tipCalcFor(r);
  const val = id => (rows.find(x => x.team_id === id) || {}).answer ?? '', cor = rows[0] ? rows[0].correct : (tq ? ansOf(tq.id) ?? '' : '');
  const d = id => c ? fmt(c.rows.find(x => x.id === id).diff) : '';
  return importCard() + `<div class="card"><h2>TIPOVAČKA – KOLO ${r}</h2><div class="nav2"><button class="ghost" ${r === 1 ? 'disabled' : ''} onclick="S.tipRound--;render()">←</button><b>KOLO ${r}</b><button class="ghost" ${r === 5 ? 'disabled' : ''} onclick="S.tipRound++;render()">→</button></div>
  ${tq ? `<p class="sm">${esc(tq.text)}</p>` : ''}<table><tr><th></th><th class="n">Odpověď</th><th class="n">Odchylka</th></tr>
  <tr><td><b>Správná odpověď</b></td><td><input id="tc" inputmode="decimal" value="${cor !== '' ? fmt(Number(cor)) : ''}"></td><td></td></tr>
  ${S.teams.map(t => `<tr><td>${esc(t.display_name)}</td><td><input class="ta" data-id="${t.id}" inputmode="decimal" value="${val(t.id) !== '' ? fmt(Number(val(t.id))) : ''}"></td><td class="n">${d(t.id)}</td></tr>`).join('')}</table>
  <p></p><button class="gold" onclick="tipSave()">Vyhodnotit tipovačku</button>
  ${c ? `<div class="res">${c.winners.length > 1 ? 'Shoda – ' + esc(joinCz(c.winners.map(tname))) : 'Bod za tip získává tým ' + esc(short(tname(c.winners[0])))}</div>${awardCard(r, c)}
  <p></p><button class="ghost" onclick="showTip()">Zobrazit na plátně</button>` : ''}</div>`;
}
function tipSave() {
  const r = S.tipRound, c = num($('#tc').value), a = [...document.querySelectorAll('.ta')].map(i => ({ id: i.dataset.id, raw: i.value.trim(), v: num(i.value) }));
  if ($('#tc').value.trim() === '') return toast('Zadejte správnou odpověď.');
  if (a.some(x => x.raw === '')) return toast('Vyplňte odpověď všech týmů.');
  if (c === null || a.some(x => x.v === null)) return toast('Zadejte platné číslo.');
  act(async () => {
    await q(db.from('tip_answers').upsert(a.map(x => ({ quiz_id: S.quiz.id, team_id: x.id, round_number: r, correct: c, answer: x.v })), { onConflict: 'team_id,round_number' }));
    document.activeElement.blur(); await load();
  });
}
function showTip() {
  const z = S.quiz, r = S.tipRound, st = steps(r);
  if (z.stage === 'setup') return toast('Nejprve zahajte kolo 1.');
  if (r > z.round_no) return toast('Toto kolo ještě nezačalo.');
  upd({ ...target(r, st.find(s => s.phase === 'tipeval')), override: null });
}
function awardCard(r, c) {
  const aw = S.awards.find(a => a.round_number === r);
  if (aw) return `<div class="res">⭐ Bod za tipovačku získal tým ${esc(tname(aw.team_id))}.</div><button class="ghost" onclick="fixAward(${r})">Opravit udělení bodu</button>`;
  const b = id => `<button class="gold" style="margin-top:8px" onclick="award(${r},'${id}')">Přidat 1 bod týmu ${esc(tname(id))} do kola ${r}</button>`;
  return c.winners.length === 1 ? '<p></p>' + b(c.winners[0]) : `<p class="sm">Shoda – bod se sám nepřidělí. Vyberte tým, nebo body zadejte ručně v záložce Výsledky.</p>${c.winners.map(b).join('')}`;
}
const award = (r, id) => confirmDlg(`Přidat 1 bod týmu ${tname(id)} do kola ${r}?`, 'Ano, přidat', () => act(async () => {
  await q(db.from('tip_awards').upsert({ quiz_id: S.quiz.id, round_number: r, team_id: id }, { onConflict: 'quiz_id,round_number', ignoreDuplicates: true }));  // idempotentní: druhý bod nevznikne
  await load(); toast('✓ Bod za tipovačku uložen', true);
}));
const fixAward = r => confirmDlg('Bod za tipovačku už byl udělen. Opravdu ho odebrat a rozhodnout znovu?', 'Ano, odebrat', () => act(async () => { await q(db.from('tip_awards').delete().eq('quiz_id', S.quiz.id).eq('round_number', r)); await load(); }));

/* ---------- 3. Výsledky ---------- */
function viewRes() {
  const z = S.quiz, cur = z.stage === 'setup' ? 1 : z.round_no, r = S.scoreRound, st = standings(S.teams, S.scores, S.awards), aw = S.awards.find(a => a.round_number === r);
  const val = id => (S.scores.find(s => s.team_id === id && s.round_number === r) || {}).points ?? '';
  return (z.stage === 'final' ? '<div class="done">KVÍZ DOKONČEN<br>🏆 KONEČNÉ POŘADÍ</div>' : '') +
  `<div class="chips">${[1, 2, 3, 4, 5].map(i => `<button class="${i === cur ? 'cur' : ''} ${i === r ? 'sel' : ''}" ${i > cur && z.stage !== 'final' ? 'disabled' : ''} onclick="S.scoreRound=${i};render()">${i}</button>`).join('')}</div>
  <div class="card"><h2>KOLO ${r}</h2><table><tr><th>Tým</th><th class="n">Body</th></tr>${S.teams.map(t => `<tr><td>${esc(t.display_name)}</td><td><input class="sc" data-id="${t.id}" inputmode="decimal" placeholder="0" value="${val(t.id) !== '' ? fmt(Number(val(t.id))) : ''}"></td></tr>`).join('')}</table>
  <p class="sm">${aw ? `⭐ Bod za tipovačku (navíc): ${esc(tname(aw.team_id))}` : 'Bod za tipovačku se zapisuje zvlášť v záložce Tipovačka.'}</p><button class="gold" onclick="sendScores()">ODESLAT BODY</button></div>
  <div class="card"><h2>${z.stage === 'final' ? 'Konečné pořadí' : 'Průběžné pořadí'}</h2><table><tr><th>Pořadí</th><th>Tým</th><th class="n">Body</th></tr>${st.map(x => `<tr><td>${x.rank}</td><td>${esc(x.display_name)}</td><td class="n"><b>${fmt(x.total)}</b></td></tr>`).join('')}</table></div>
  <details class="card"><summary><b>Názvy týmů</b></summary>${S.teams.map(t => `<label>Tým ${t.team_number}</label><input class="nm" data-id="${t.id}" value="${esc(t.display_name)}" maxlength="30">`).join('')}<p></p><button class="ghost" onclick="saveNames()">Uložit názvy</button></details>`;
}
function sendScores() {
  const a = [...document.querySelectorAll('.sc')].map(i => ({ id: i.dataset.id, raw: i.value.trim(), v: num(i.value) })), r = S.scoreRound;
  if (a.some(x => x.raw === '')) return toast('Zadejte body pro všechny týmy.');
  if (a.some(x => x.v === null)) return toast('Zadejte platné číslo.');
  if (a.some(x => !half(x.v))) return toast('Body musí být nezáporné, po půlbodech (např. 0,5; 1; 1,5).');
  act(async () => {
    await q(db.from('round_scores').upsert(a.map(x => ({ quiz_id: S.quiz.id, team_id: x.id, round_number: r, points: x.v })), { onConflict: 'team_id,round_number' }));
    document.activeElement.blur(); await load(); toast(`✓ Body kola ${r} uloženy`, true);
  });
}
function saveNames() {
  const a = [...document.querySelectorAll('.nm')].map(i => ({ id: i.dataset.id, n: i.value.trim() }));
  if (a.some(x => !x.n)) return toast('Název týmu nesmí být prázdný.');
  act(async () => { for (const x of a) await q(db.from('teams').update({ display_name: x.n }).eq('id', x.id)); document.activeElement.blur(); await load(); toast('✓ Názvy uloženy', true); });
}

document.querySelector('nav').addEventListener('click', e => { const t = e.target.closest('button'); if (t) { document.activeElement.blur(); S.tab = t.dataset.t; render(); } });
(async () => {
  try {
    S.authed = !!(await db.auth.getSession()).data.session;
    if (S.authed) { await syncClock(); await load(); } else render();
    let tm; db.channel('mod').on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => { clearTimeout(tm); tm = setTimeout(() => S.authed && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && act(load), 200); }).subscribe();
  } catch (e) { console.error(e); render(); toast('Připojení k serveru bylo ztraceno.'); }
})();
