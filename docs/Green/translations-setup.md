# GREEN þýðingar — uppsetning (Resend · Supabase · Netlify)

Sameiginlegt minnisblað fyrir uppsetninguna á þýðingarfasanum.
**Engin leyndarmál í þessa skrá** — API-lyklar og `service_role`-lykill fara aðeins í
Resend/Supabase sjálf eða í `.env` (sem er í `.gitignore`).

| | |
|---|---|
| Vefurinn | `https://green.rafdeild.com` (í dag `https://erasmusgreen.netlify.app`) |
| Þýðingarritillinn | `https://green.rafdeild.com/translations` |
| Sendandi pósts | `GREEN Erasmus+ <green@rafdeild.com>` |
| Innskráning | töfrahlekkur (magic link), þýðendur skrá sig sjálfir |
| Lok þýðingarfasa | 15. desember 2026 (sveigjanlegt) |

Merki: ☐ ógert · ☑ búið. **Þú** = Friðrik, **Claude** = ég.

---

## 1. Resend — **Þú**

### 1.1 Lénið - Komið
Komið - ☐ Resend → **Domains → Add Domain** → `rafdeild.com`
- ☐  **Region: Ireland (eu-west-1)** — ESB, vegna persónuverndar
- ☐ Setja DNS-færslurnar sem Resend sýnir hjá lénaskráningunni. Þær líta svona út
  (afritaðu gildin **úr Resend**, ekki héðan):

| Tegund | Nafn | Gildi | Athugasemd |
|---|---|---|---|
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` (forgangur 10) | aðeins fyrir skopp-póst |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF — á undirléninu `send` |
| TXT | `resend._domainkey` | langur DKIM-lykill | |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | **aðeins ef engin DMARC-færsla er fyrir** |

  Færslurnar eru á undirlénunum `send` og `resend._domainkey`, svo **póstur sem rafdeild.com
  hefur nú þegar (MX og SPF á rótinni) breytist ekki.**
- ☐ Bíða eftir **Verified** (nokkrar mínútur, stundum klukkutími)

### 1.2 API-lykill - komið 
- ☐ **API Keys → Create API Key** · nafn `supabase-smtp` · **Permission: Sending access** · domain `rafdeild.com`
  Óli : setti API sem [Rafdeild_supabase-smtp](https://resend.com/api-keys/23fe316c-e6e6-4b40-809f-9cb9486ef2f9)
- ☐ Geyma lykilinn (`re_…`) — hann er notaður einu sinni, í skrefi 2.3. **Ekki** í þessa skrá.

### 1.3 Pósthólf?
Ekki þarf pósthólf til að **senda**. En svör við `green@rafdeild.com` lenda hvergi nema
pósthólf sé til. Supabase leyfir **ekki** að setja Reply-To, svo:
- annaðhvort er netfang til að hafa samband í texta póstsins (sjá sniðmátið í 2.5), eða
- búið til áframsendingu `green@rafdeild.com` → þitt netfang hjá póstþjóninum.

### 1.4 Prófun
- ☐ Senda prufupóst úr Resend á Gmail-netfang → berst, **ekki** í ruslpósti.

---

## 2. Supabase — **Þú stofnar, Claude stillir rest með þér**

### 2.1 Verkefnið
- ☐ **New project** · nafn GreenErasmus · **Region: Central EU (Frankfurt)**
- ☐ Lykilorð gagnagrunns → í lykilorðastjóra, ekki hér.
  
  Setti upp, tengdi github við, /supabase sem folder.
  api : sb_publishable_F954DkLOzQehYj6MaCCiGg_W-rTI16p
  url : https://towcilpglemxxqhjqppn.supabase.co

### 2.2 Lyklar (Project Settings → API)
| Lykill | Hvert | Opinber? |
|---|---|---|
| Project URL | í kóða vefsins | já |
| `anon` / publishable key | í kóða vefsins | já — reglurnar (RLS) verja gögnin |
| `service_role` / secret key | **aðeins** `.env` á vélinni sem flytur út | **NEI, aldrei í git eða vafra** |

### 2.3 SMTP (Authentication → Emails → SMTP Settings)
- ☐ **Enable Custom SMTP: on**

| Reitur       | Gildi                                                |
| ------------ | ---------------------------------------------------- |
| Sender email | `green@rafdeild.com`- Setti hér noreply@rafdeild.com |
| Sender name  | `GREEN Erasmus+` - VMA Rafdeild hér                  |
| Host         | `smtp.resend.com`                                    |
| Port         | `465`                                                |
| Username     | `resend`                                             |
| Password     | Resend API-lykillinn úr 1.2                          |

### 2.4 Innskráning
**Authentication → Sign In / Providers**
- ☐ **Allow new users to sign up: on** (þýðendur skrá sig sjálfir)
- ☐ **Email: enabled** · **Confirm email: on**

**Authentication → URL Configuration**
- ☐ **Site URL:** `https://green.rafdeild.com/translations`
- ☐ **Redirect URLs:**
  - `https://green.rafdeild.com/**`
  - `https://erasmusgreen.netlify.app/**`
  - `http://localhost:8766/**`

**Authentication → Rate Limits** (aðeins breytanlegt eftir að SMTP er komið inn)
- ☐ **Emails sent per hour:** `100`

### 2.5 Póstsniðmát (Authentication → Emails → Templates)
Sama efni í **Confirm signup** og **Magic Link** (nýir notendur fá það fyrra, aðrir það síðara).

**Subject:** `Your sign-in link — GREEN translations`

```html
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1a1d27">
  <h2 style="color:#1B6B3A">GREEN Erasmus+ · translations</h2>
  <p>Click the button to sign in and review the worksheets in your language.</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}"
       style="background:#1B6B3A;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">
      Sign in to GREEN translations</a>
  </p>
  <p style="font-size:13px;color:#5f6b76">The link works once and expires after one hour.
     If you did not ask for it, you can ignore this email.</p>
  <p style="font-size:13px;color:#5f6b76">Questions: <!-- TODO: netfang sem einhver les --></p>
  <hr style="border:none;border-top:1px solid #dfe1e6">
  <p style="font-size:11px;color:#8b90a0">GREEN Erasmus+ KA220-VET · Project № 2025-1-HR01-KA220-VET-000353056</p>
</div>
```
- ☐ Setja inn netfang í `Questions:` línuna (sjá 1.3)

### 2.6 Prófun
- ☐ Skrá sig á `http://localhost:8766/translations` (þegar Claude hefur smíðað síðuna) →
  póstur frá `green@rafdeild.com` berst → hlekkurinn skráir inn.

---

## 3. Netlify — **Þú**
- ☐ Netlify → `erasmusgreen` → **Domain management → Add a domain** → `green.rafdeild.com`
- ☐ DNS hjá lénaskráningunni: **CNAME** `green` → `erasmusgreen.netlify.app`
- ☐ Bíða eftir **HTTPS** (Let's Encrypt, sjálfvirkt)
- ☐ `https://green.rafdeild.com` opnar vefinn; gamla slóðin virkar áfram.

---

## 4. Það sem Claude gerir þegar 1–3 eru tilbúin
- ☐ Töflur, reglur (RLS) og gikkur í `supabase/schema.sql` (í git)
- ☐ Vélþýðing allra blaða → JSON → hlaðið í Supabase
- ☐ Innskráningarsíða og ritill á `/translations` og á verkefnablöðunum
- ☐ `node tools/reader.mjs from-supabase` — útflutningur í `lang/*.json`

## Hvað Claude þarf frá þér
Bara tvö **opinber** gildi: **Project URL** og **anon key** (2.2). Ekkert annað leyndarmál.
