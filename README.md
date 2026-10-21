# Kvízový moderátor v2

Statická aplikace (HTML/CSS/JS) + Supabase. Bez Node.js serveru a bez build kroku.

## 1. Soubory
| Soubor | Účel |
|---|---|
| `moderator.html` + `moderator.js` | aplikace moderátora (3 záložky: Rozřazení, Tipovačka, Výsledky) včetně ovládání prezentace, odpočtu, přestávky a importu TXT |
| `display.html` + `display.js` | veřejná obrazovka (plátno/TV), řízená sdíleným stavem v databázi |
| `rozrazeni.html` + `rozrazeni.js` | stránka pro hráče z QR kódu (jediné tlačítko „ROZŘAĎ MNE“) |
| `common.js` | sdílená logika (pořadí, vyhodnocení tipu, parser TXT, QR, čas serveru) |
| `config.js` | **sem vložte Supabase URL a anon klíč** |
| `styles.css` | styly moderátora a rozřazení (display má styly přímo v HTML) |
| `schema.sql` | kompletní databáze: tabulky, RLS, funkce, realtime |
| `priklad_otazky.txt` | vzorový import (5 kol) |

## 2. Nastavení Supabase
1. Na supabase.com vytvořte projekt.
2. *SQL Editor* → vložte celý `schema.sql` → *Run*. (Skript nejdřív smaže tabulky předchozí verze aplikace!) Vytvoří tabulky, RLS politiky, funkce `assign_player()` a `server_time()` a zapne Realtime pro tabulky `quizzes, teams, round_scores, tip_awards, questions, players`.
3. *Authentication → Users → Add user*: e-mail + heslo moderátora (*Auto Confirm*). Veřejnou registraci vypněte (*Sign In / Providers → Allow new users to sign up*).
4. *Project Settings → API*: zkopírujte *Project URL* a *anon/publishable* klíč do `config.js`. Service-role klíč nikdy nevkládejte.
5. Pokud by Realtime nefungoval: *Database → Replication* a ověřte, že jsou tabulky výše zapnuté (display má jako zálohu i dotazování každých 20 s).

## 3. Nasazení
Nahrajte všechny soubory kromě `schema.sql` na statický hosting (GitHub Pages, Netlify, Cloudflare Pages). Moderátor: `…/moderator.html` (přihlášení účtem z kroku 3). Veřejná obrazovka: `…/display.html` (bez přihlášení, stačí F11). QR kód se generuje z adresy, na které aplikace skutečně běží, takže funguje na jakémkoli hostingu.

## 4. Průběh kvízu
1. **Nový kvíz** – zadejte počet týmů (jen jednou). Počet je pak společný pro všechny záložky.
2. **Rozřazení** – zadejte počet hráčů, ukažte QR (v aplikaci nebo „QR na plátno“). Hráči skenují a mačkají „ROZŘAĎ MNE“; přidělení probíhá atomicky v databázi (zámek řádku kvízu), takže souběžné kliknutí neporuší rovnoměrnost ani limit. Plnou obrazovku s QR má plátno i automaticky v tomto stavu.
3. **Import otázek** – záložka Tipovačka → „Načíst otázky z TXT“: vyberte soubor, případně text upravte, „Zkontrolovat import“, prohlédněte náhled, „Potvrdit import“. Chybný formát import zablokuje; nahrazení existujících otázek vyžaduje potvrzení. Formát: viz `priklad_otazky.txt` (`KOLO n: Název`, `OTÁZKA n`, `ODPOVĚĎ:`, `TIPOVAČKA`, `SPRÁVNÁ ODPOVĚĎ:` – číslo). Každé z 5 kol musí mít ≥1 otázku a právě 1 tipovačku.
4. **Řízení prezentace** – panel nahoře (vždy viditelný) projde každé kolo pevným sledem: otázky bez odpovědí → tipovačka → odpočet → otázky s odpověďmi → vyhodnocení tipovačky → výsledky kola → další kolo. Po 5. kole „Další“ nabídne ukončení a konečné pořadí. Tlačítko „Zpět“ jen mění zobrazení, nikdy nepřičítá body. Přeskočení odpočtu a vyhodnocení bez vyplněné tipovačky aplikace hlídá.
5. **Odpočet** – délka v minutách (výchozí 2), Spustit / Pozastavit / Pokračovat / Zastavit / Reset. V DB je čas konce (čas serveru), takže přežije obnovení stránky a nikdy se sám nespustí znovu. Posledních 10 s je červeně a pulzuje, po vypršení se zobrazí „Čas vypršel!“.
6. **Tipovačka** – v záložce Tipovačka zadejte správnou odpověď a tipy týmů (desetinná čárka je povolena), „Vyhodnotit tipovačku“. Při jednom vítězi se nabídne „Přidat 1 bod týmu … do kola …“ (s potvrzením), při shodě musíte tým vybrat sami nebo body zadat ručně. Bod je uložen zvlášť (`tip_awards`, max. 1 na kolo, jistota na úrovni DB), oprava vyžaduje „Opravit udělení bodu“. „Zobrazit na plátně“ skočí na vyhodnocení tipovačky.
7. **Výsledky** – ruční body po půlbodech (0; 0,5; 1; 1,5…) za kolo v jedné tabulce; opětovné odeslání záznam přepíše. Celkem = ruční body + body za tipovačku. Stejné body = stejné pořadí. Zde se také přejmenovávají týmy (ID zůstává `team_N`).
8. **Přestávka** – tlačítko „Přestávka“ (délka v panelu), „Ukončit přestávku“ vrátí prezentaci přesně tam, kde byla. Přestávka sdílí odpočet s tipovačkou (při jejím ukončení se odpočet zastaví).
9. **Nový kvíz** – tlačítko vpravo nahoře, vyžaduje potvrzení; plátno přejde na nový kvíz samo.

## 5. Bezpečnost – co skutečně platí
- Správné odpovědi a tipy týmů jsou v tabulkách `answers` a `tip_answers`, které **nemají veřejné čtení** (RLS) – anonymní klient je z databáze nedostane. Na veřejné tabulky se odpověď dostane až ve chvíli, kdy ji moderátor zveřejní (`quizzes.shown_answer`, `quizzes.tip_reveal`).
- Zadání otázek (`questions`) jsou veřejná – kdo zná anon klíč, může si přečíst zadání budoucích kol, ale ne odpovědi.
- Zápis (body, stav, otázky) smí jen přihlášený moderátor. Anonymní uživatelé smějí volat jen `assign_player()` (přidělí hráče, nic jiného) a `server_time()`.
- Rozřazovací stránku může kdokoli, kdo zná adresu, spustit opakovaně (např. vymazáním úložiště prohlížeče) – limit počtu hráčů to ale vždy zastaví. Hráče nelze ověřit; je to záměrně bez registrace.
- Hostingu je nutné důvěřovat: anon klíč je ve frontendu veřejný, bezpečnost stojí na RLS.

## 6. Časté problémy
- *„Přihlášení se nezdařilo“* – uživatel nebyl vytvořen/potvrzen (krok 3).
- *Prázdné plátno / nic se nemění* – zkontrolujte `config.js`, že proběhl `schema.sql` a Realtime.
- *Při rozřazení „Rozřazování ještě nebylo zahájeno“* – moderátor musí uložit počet hráčů.
- *Import hlásí chyby* – řiďte se seznamem chyb; opravit lze přímo v textovém poli.
- *QR vede na špatnou adresu* – otevřete `moderator.html` z nasazené adresy, ne ze souboru na disku.
