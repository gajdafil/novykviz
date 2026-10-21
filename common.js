const db = typeof supabase !== 'undefined' ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { v = String(v).trim().replace(/\s/g, '').replace(',', '.'); return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null; };
const half = v => v !== null && v >= 0 && Math.round(v * 2) === v * 2;
const fmt = v => String(Number(Number(v).toFixed(2))).replace('.', ',');
const short = n => /^Tým \d+$/.test(n) ? n.slice(4) : n;
const joinCz = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' a ' + a[a.length - 1];
const rozUrl = () => new URL('rozrazeni.html', location.href).href;   // skutečná URL aktuálního nasazení
const qrSvg = url => { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); };

// čas serveru (odpočet nezávisí na hodinách zařízení)
let skew = 0;
async function syncClock() { try { const t0 = Date.now(); const { data } = await db.rpc('server_time'); if (data) skew = new Date(data).getTime() - (t0 + Date.now()) / 2; } catch (e) {} }
const now = () => Date.now() + skew;
const timerLeft = z => z.timer_state === 'run' ? Math.max(0, Math.ceil((new Date(z.timer_end) - now()) / 1000)) : z.timer_state === 'pause' ? z.timer_left : z.timer_total;
const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

// pořadí = ruční body + bod za tipovačku; stejné body = stejné pořadí
function standings(teams, scores, awards) {
  const l = teams.map(t => {
    const per = {}; for (let r = 1; r <= 5; r++) per[r] = scores.filter(s => s.team_id === t.id && s.round_number === r).reduce((a, s) => a + Number(s.points), 0)
      + (awards.some(a => a.team_id === t.id && a.round_number === r) ? 1 : 0);
    return { ...t, per, total: Object.values(per).reduce((a, b) => a + b, 0) };
  }).sort((a, b) => b.total - a.total || a.team_number - b.team_number);
  l.forEach(x => x.rank = 1 + l.filter(y => y.total > x.total).length);
  return l;
}
function tipCalc(c, a) {   // a: [{id, a}]
  const rows = a.map(x => ({ id: x.id, answer: x.a, diff: Math.round(Math.abs(x.a - c) * 1e6) / 1e6 }));
  const m = Math.min(...rows.map(x => x.diff));
  return { correct: c, rows, winners: rows.filter(x => x.diff === m).map(x => x.id) };
}

// parser TXT – nic si nedomýšlí, nejasnosti hlásí jako chyby (blokují import) nebo varování
function parseTxt(txt) {
  const err = [], warn = [], R = []; let r = null, sub = null, cur = null, m;
  txt.replace(/\r/g, '').split('\n').forEach((raw, i) => {
    const ln = raw.trim(); if (!ln) return; const at = `Řádek ${i + 1}: `;
    if ((m = ln.match(/^KOLO\s+(\d+)\b.*$/i))) { r = { n: +m[1], subs: [], tips: [] }; R.push(r); sub = cur = null; }
    else if (!r) err.push(at + 'text před prvním kolem.');
    else if ((m = ln.match(/^PODOKRUH\s*\d*\s*[:.\-–—]?\s*(.*)$/i))) { sub = { title: m[1].trim(), qs: [] }; r.subs.push(sub); cur = null; }
    else if ((m = ln.match(/^OT[ÁA]ZKA\s+(\d+)\s*:?\s*$/i))) {
      if (!sub) { err.push(at + 'otázka je mimo podokruh.'); cur = null; } else { cur = { n: +m[1], text: '', ans: null }; sub.qs.push(cur); } }
    else if (/^TIPOVAČKA\s*:?\s*$/i.test(ln)) { cur = { text: '', ans: null }; r.tips.push(cur); sub = null; }
    else if ((m = ln.match(/^(?:SPRÁVNÁ\s+)?ODPOVĚĎ\s*:\s*(.*)$/i))) {
      if (!cur) err.push(at + 'odpověď bez otázky.'); else if (cur.ans !== null) err.push(at + 'otázka má více řádků „ODPOVĚĎ:“.'); else cur.ans = m[1].trim(); }
    else if (cur) { if (cur.ans === null) cur.text += (cur.text ? ' ' : '') + ln; else cur.ans += (cur.ans ? '\n' : '') + ln; }   // odpověď může mít více řádků
    else err.push(at + 'nerozpoznaný řádek.');
  });
  if (!R.length) err.push('Nenalezeno žádné kolo.');
  for (let k = 1; k <= 5; k++) if (!R.some(x => x.n === k)) err.push(`Chybí kolo ${k}.`);
  R.forEach((x, i) => {
    const p = `Kolo ${x.n}: `;
    if (x.n < 1 || x.n > 5) err.push(p + 'číslo kola musí být 1–5.');
    if (R.filter(y => y.n === x.n).length > 1 && R.findIndex(y => y.n === x.n) === i) err.push(p + 'kolo je uvedeno vícekrát.');
    if (x.subs.length !== 2) err.push(p + `musí mít právě 2 podokruhy (nalezeno ${x.subs.length}).`);
    x.subs.forEach((s, si) => {
      const sp = `${p}podokruh ${si + 1}: `;
      if (!s.title) err.push(sp + 'chybí název.');
      if (!s.qs.length) err.push(sp + 'chybí otázky.');
      s.qs.forEach((q, j) => { if (q.n !== j + 1) err.push(`${sp}otázka ${q.n} má špatné pořadové číslo (čekáno ${j + 1}).`);
        if (!q.text) err.push(`${sp}otázka ${q.n} nemá zadání.`); if (!q.ans) err.push(`${sp}otázka ${q.n} nemá odpověď.`);
        else if (q.ans.includes('\n')) warn.push(`${sp}otázka ${q.n} má odpověď na ${q.ans.split('\n').length} řádcích – zkontrolujte náhled, zda tam nepatří chybějící hlavička další otázky.`); });
    });
    if (x.tips.length === 0) err.push(p + 'chybí tipovačka.'); else if (x.tips.length > 1) err.push(p + 'tipovačka je uvedena vícekrát.');
    x.tips.forEach(t => { if (!t.text) err.push(p + 'tipovačka nemá zadání.'); if (t.ans === null || t.ans === '') err.push(p + 'tipovačka nemá správnou odpověď.'); else if (num(t.ans) === null) err.push(p + 'správná odpověď tipovačky musí být číslo.'); });
  });
  return { rounds: R, errors: err, warnings: warn };
}
const qcount = P => P.rounds.reduce((a, r) => a + r.subs.reduce((b, s) => b + s.qs.length, 0), 0);
if (typeof module !== 'undefined') module.exports = { num, half, standings, tipCalc, parseTxt, qcount };
