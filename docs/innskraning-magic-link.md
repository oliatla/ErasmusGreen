# Innskráning með töfrahlekk — uppskrift til endurnýtingar

Hvernig innskráningin á `green.rafdeild.com/translations` er byggð, svo hægt sé að
setja hana upp aftur á öðrum vefjum (t.d. **smafiskar.is** og
**sveinsprof.rafdeild.com**). Skrifað nóvember 2026, eftir uppsetninguna í GREEN.

**Engin leyndarmál í þessa skrá.** API-lyklar Resend og `service_role`/secret-lykill
Supabase fara aðeins í Resend/Supabase sjálf eða í `.env` (sem er í `.gitignore`).

---

## 1. Hvað þetta er

- **Engin lykilorð.** Notandi slær inn netfang, fær hlekk í tölvupósti, smellir og er
  innskráður. Hlekkurinn virkar einu sinni og í eina klukkustund.
- **Kyrrstæður vefur** (HTML + JS, engin smíði), hýstur á Netlify. Engin eigin þjónn.
- **Supabase** (í ESB, Frankfurt) sér um innskráningu og gagnagrunn. Allar reglur um
  hver má lesa og skrifa hvað búa í gagnagrunninum sjálfum (Row Level Security), svo
  opinberi lykillinn í vafranum má sjást.
- **Resend** sendir póstinn, frá eigin léni (t.d. `noreply@rafdeild.com`), svo hann
  komist í gegnum ruslpóstsíur betur en sjálfgefni póstur Supabase.
- **Persónuvernd innbyggð:** samþykki áður en netfangið er sent, notandi getur eytt sér
  sjálfur, nöfn falin sjálfgefið, eyðing gagna á fyrir fram ákveðnum degi.

```
vafri ──(netfang)──▶ Supabase Auth ──SMTP──▶ Resend ──▶ pósthólf notandans
  ▲                                                          │
  └──────────────── töfrahlekkur (/slóð#access_token=…) ◀────┘
vafri ──(lykill + JWT)──▶ Supabase REST ──▶ Postgres (RLS ræður öllu)
```

---

## 2. Það sem er þegar til (endurnýtanlegt)

| Hlutur | Staða | Endurnýting |
|---|---|---|
| Resend-aðgangur | til | sami aðgangur fyrir öll verkefnin |
| Lénið `rafdeild.com` í Resend | staðfest (DNS: `send`, `resend._domainkey`, `_dmarc`) | **sveinsprof.rafdeild.com** getur sent frá `noreply@rafdeild.com` — ekkert nýtt DNS |
| Lénið `smafiskar.is` í Resend | staðfest | smafiskar.is sendir frá `noreply@smafiskar.is` |
| Supabase-verkefni `GreenErasmus` | í notkun fyrir GREEN | **ekki** endurnýta — hvert verkefni fær sitt eigið (aðskildir notendur og gögn) |
| Kóði í þessu repo | sjá kafla 6 | afrita og aðlaga |

**Ein regla:** eitt Supabase-verkefni á hvern vef, en Resend-aðgangurinn og lénin eru
sameiginleg. Búðu til **sér API-lykil í Resend fyrir hvert Supabase-verkefni**
(t.d. `sveinsprof-smtp`, `smafiskar-smtp`), svo hægt sé að loka einum án þess að hin
hætti að virka.

---

## 3. Uppsetning skref fyrir skref

### 3.1 Resend (bara ef lénið er nýtt)
1. **Domains → Add Domain** → lénið · **Region: Ireland (eu-west-1)**.
2. Setja DNS-færslurnar sem Resend sýnir. Þær fara á undirlénin `send` og
   `resend._domainkey`, svo **póstur sem lénið hefur fyrir breytist ekki** og
   SPF-færslan á rótinni er óhreyfð. DMARC (`_dmarc` = `v=DMARC1; p=none;`) aðeins ef engin er fyrir.
3. Bíða eftir **Verified**.
4. **API Keys → Create** · *Sending access* · bundinn við lénið · eitt nafn á verkefni.

Pósthólf þarf ekki til að senda. Svör við `noreply@…` týnast — setjið netfang sem einhver
les í texta póstsins (Supabase leyfir ekki Reply-To).

### 3.2 Supabase
1. **New project** · **Region: Central EU (Frankfurt)** · lykilorð gagnagrunns í lykilorðastjóra.
2. **Authentication → Emails → SMTP Settings** → *Enable Custom SMTP*:

   | Reitur | Gildi |
   |---|---|
   | Sender email | `noreply@rafdeild.com` (eða `noreply@smafiskar.is`) |
   | Sender name | t.d. „VMA Rafdeild“ / „Smáfiskar“ |
   | Host · Port | `smtp.resend.com` · `465` |
   | Username | `resend` |
   | Password | Resend API-lykillinn |

3. **Authentication → Sign In / Providers:** *Allow new users to sign up* (ef fólk skráir sig
   sjálft) · *Email* á · *Confirm email* á.
4. **Authentication → URL Configuration** — ⚠ mikilvægast:
   - **Site URL:** síðan sem tekur við hlekknum, t.d. `https://sveinsprof.rafdeild.com/innskraning/`
   - **Redirect URLs:** `https://<lén>/**` og `http://localhost:<port>/**` til prófana.
   - Ef slóðin er ekki á listanum notar Supabase Site URL, og sjálfgefna gildið er
     `http://localhost:3000` → hlekkurinn vísar á localhost. (Gerðist hjá okkur.)
5. **Authentication → Rate Limits:** hækka „emails per hour“ (t.d. 100) — aðeins hægt eftir að SMTP er komið inn.
6. **Authentication → Emails → Templates:** sama efni í *Confirm signup* og *Magic Link*
   (nýir notendur fá það fyrra). Hlekkurinn er `{{ .ConfirmationURL }}`. Sjá sniðmátið í
   [Green/translations-setup.md](Green/translations-setup.md), kafla 2.5.
7. **Project Settings → API:** Project URL og *publishable/anon* lykill fara í kóðann
   (opinber). *Secret/service_role* fer aldrei í vafra eða git.
8. **GitHub-tenging** (Project Settings → Integrations → GitHub): repo + mappa `supabase` +
   grein `main`. Þá keyrir Supabase nýjar skrár í `supabase/migrations/` sjálfkrafa við hvert push.
   Villur sjást sem GitHub-athugun „Supabase Preview“ á færslunni.

### 3.3 Netlify
Bæta léninu við (*Domain management*), CNAME á `<síða>.netlify.app`, bíða eftir HTTPS.

### 3.4 Prófun
1. Skrá sig með **persónulegu netfangi fyrst** (t.d. smafiskar.is), ekki skólanetfangi.
2. Póstur berst frá réttum sendanda → hlekkurinn opnar *réttan vef* (ekki localhost).
3. Prófa reglurnar utan frá sem óinnskráður gestur: lestur á töflum á að skila `[]` og
   skrif `42501 … row-level security policy`.

---

## 4. Gagnagrunnsmynstrin (Row Level Security)

Skrárnar í `supabase/migrations/` eru fyrirmyndin. Mynstrin sem skipta máli:

- **Prófíll notandans** (`translators` hér): ein röð á notanda, lykill = `auth.users.id`
  (`on delete cascade`). **Hver les aðeins sína eigin röð** — annars sjá allir netföng allra.
  (Við byrjuðum með „allir innskráðir lesa allt“ — það var leki.)
- **Nöfn sem aðrir mega sjá** í gegnum *view* sem skilar `null` ef notandi vill vera
  nafnlaus (`translator_names`). Sjálfgefið nafnlaust.
- **Hvaða dálkum notandi má breyta:** `revoke update … ; grant update (name, …)` — svo
  enginn geti t.d. tekið af sér `blocked`.
- **Hjálparfall** `my_lang()` (`security definer`) sem reglurnar nota.
- **Saga:** gikkur skrifar hverja breytingu í töflu sem enginn getur breytt.
- **Opinber tölfræði án persónuupplýsinga:** `security definer`-fall sem skilar bara tölum,
  `grant execute … to anon` (`translation_status()`).
- **„Eyða mér“:** fall `delete_me()` eyðir úr `auth.users`; erlendir lyklar annarra taflna eru
  `on delete set null`, svo framlag notandans stendur áfram nafnlaust.
- **Eyðing allra persónuupplýsinga** á ákveðnum degi: handvirk SQL-skrá
  (`supabase/manual/`), **ekki** í `migrations/` (þá keyrði hún sjálfkrafa).

⚠ Skrifið SQL-skrár með ritli, ekki í gegnum bash-heredoc: bash át `$$` í falli hjá okkur
og Supabase hafnaði skránni.

---

## 5. Innskráningarsíðan (vafrinn)

Fyrirmynd: [`translations/index.html`](../translations/index.html) og [`js/supabase-config.js`](../js/supabase-config.js).

1. **Skref 1 — persónuvernd:** aðeins textinn og hakið „Ég hef lesið þetta og samþykki“.
   Netfangsreiturinn er falinn þar til hakað er (Supabase geymir netfangið um leið og
   beðið er um hlekk, svo samþykkið verður að koma fyrst).
2. **Skref 2 — leiðbeiningar og netfang:** persónuverndartextinn hverfur („✓ samþykkt ·
   lesa aftur“), leiðbeiningarnar birtast *fyrir ofan* netfangsreitinn og síðan skrunar
   efst í þær, svo fólk les þær.
3. `signInWithOtp({ email, options: { emailRedirectTo } })` — `emailRedirectTo` verður að
   vera á Redirect-listanum.
4. **Fyrsta innskráning:** prófílform (nafn, val, „sýna nafnið mitt“, samþykki skráð með tíma).
5. **Stillingar:** „sýna nafnið mitt“ og **„Eyða mér“** (með staðfestingu).
6. `flowType: 'implicit'` í `createClient` — hlekkurinn virkar þá líka þótt hann sé opnaður
   í öðrum vafra eða tæki en þeim sem bað um hann (PKCE gerir það ekki).

Persónuverndartextinn (7 atriði): ábyrgðaraðili, hvað er geymt, til hvers, hvar (ESB + IP-tala
við innskráningu), hve lengi (dagsetning), nafnleynd, réttur til að eyða sér.

---

## 6. Lærdómar

- **Site URL / Redirect URLs** eru algengasta villan — hlekkurinn fer á localhost.
- **Skólanetföng** (vma.is o.fl. á Microsoft 365) setja póst frá nýju léni oft í sóttkví.
  Segið það á síðunni og bendið á persónulegt netfang; biðjið tölvudeild að treysta léninu.
- **Ókeypis Supabase sefur** eftir viku án notkunar — í lagi meðan fólk notar vefinn, en
  flytjið gögn út áður en verkefni lýkur.
- **Chrome kann ekki íslensk tíma- og talnasnið** (`Intl`): notið `hour12: false` og skiptið
  `.` í `,` sjálf.
- **Vafrinn geymir gamlar JS-skrár:** Ctrl+F5 eftir hverja útgáfu.

---

## 7. Aðlögun fyrir næstu verkefni

### sveinsprof.rafdeild.com — skráning á námskeið
- Resend: **ekkert nýtt** — `noreply@rafdeild.com`, nýr API-lykill `sveinsprof-smtp`.
- Supabase: nýtt verkefni (Frankfurt). Site URL `https://sveinsprof.rafdeild.com/…`.
- Í stað „þýðanda + tungumáls“: **þátttakandi + námskeið** (tafla `registrations`:
  user_id, námskeið, dagsetning, staða). Kennari/stjórnandi sér allar skráningar
  (eigin regla, t.d. tafla `admins`).
- **Lágmarka gögn:** spyrja aðeins um það sem þarf. Kennitölu aðeins ef hún er nauðsynleg —
  hún kallar á meiri vernd og skýrari tilgang í persónuverndartextanum.
- Persónuverndartexti: ábyrgðaraðili VMA, tilgangur = skráning á námskeið, geymslutími
  (t.d. eytt X mánuðum eftir námskeið).

### smafiskar.is
- Resend: `noreply@smafiskar.is`, API-lykill `smafiskar-smtp`.
- Supabase: nýtt verkefni. Site URL og Redirect URLs fyrir `smafiskar.is`.
- Sama innskráningarsíða og skref 1–2; prófíll og töflur eftir þörfum vefsins.

### Gátlisti
- [ ] Resend: lén staðfest · API-lykill fyrir þetta verkefni
- [ ] Supabase: verkefni í Frankfurt · SMTP · sign-up/confirm · **Site URL + Redirect URLs** · rate limit · sniðmát
- [ ] GitHub-tenging Supabase (`supabase/` · `main`)
- [ ] Persónuverndartexti með dagsetningu eyðingar · samþykki fyrst
- [ ] RLS: hver les aðeins sinn prófíl · prófað utan frá
- [ ] „Eyða mér“ · handvirk eyðingarskrá + áminning í dagatali
- [ ] Prófað með persónulegu netfangi og svo skólanetfangi
