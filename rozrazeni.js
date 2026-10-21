const out = $('#out'), KEY = 'kviz_hrac';
const MSG = { FULL: 'Všichni hráči už jsou rozřazeni.', NO_QUIZ: 'Kvíz zatím neběží.', NO_COUNT: 'Rozřazování ještě nebylo zahájeno. Zkuste to za chvíli.' };
const lab = n => 'týmu ' + short(n);
function ok(r) { out.innerHTML = `<h1>Jsi v ${esc(lab(r.name))} 🎉</h1><p>Hráč ${r.player}</p>`; }
function ask(msg) { out.innerHTML = `<h1>Rozřazení do týmů</h1><p>Stiskni tlačítko a zjistíš, ve kterém týmu hraješ.</p>${msg ? `<p class="err">${esc(msg)}</p>` : ''}<button class="big gold" id="b">ROZŘAĎ MNE</button>`; $('#b').onclick = go; }
async function go() {
  $('#b').disabled = true;
  try {
    const { data, error } = await db.rpc('assign_player');
    if (error) { const k = Object.keys(MSG).find(k => (error.message || '').includes(k)); return ask(MSG[k] || 'Rozřazení se nezdařilo. Zkontrolujte připojení a zkuste to znovu.'); }
    localStorage.setItem(KEY, JSON.stringify(data)); ok(data);
  } catch (e) { ask('Připojení k serveru bylo ztraceno. Zkuste to znovu.'); }
}
(async () => {
  try {
    const { data: z } = await db.from('quizzes').select('id').eq('active', true).order('created_at', { ascending: false }).limit(1);
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && z[0] && s.quiz === z[0].id) {   // už rozřazen v aktuálním kvízu – jen znovu ukážeme výsledek (aktuální název týmu)
      const { data: t } = await db.from('teams').select('display_name').eq('quiz_id', s.quiz).eq('team_number', s.team).single();
      return ok({ ...s, name: t ? t.display_name : s.name });
    }
  } catch (e) {}
  ask();
})();
