# Geschenkkiste – Geschenke-Manager (ISEF01)

Mit dem Geschenke-Manager „**Geschenkkiste**“ entwickeln wir eine webbasierte Anwendung, die den Alltag erleichtert, indem sie das Planen, Organisieren und Finden von Geschenkideen an einem zentralen Ort bündelt. Unser Ziel ist es, kreative Inspiration, persönliche Planung und strukturierte Übersicht in einem System zu vereinen. Nutzende sollen jederzeit unkompliziert passende Geschenkideen entdecken, Erinnerungen erhalten und ihre Planungen übersichtlich verwalten können. So wird verhindert, dass doppelte Geschenke entstehen.
Die Geschenkkiste soll nicht nur Orientierung schaffen, sondern dabei unterstützen, anderen eine Freude zu bereiten – ohne Stress, ohne Zeitdruck und ohne den Überblick zu verlieren.

---

## Inhaltsverzeichnis
- [Live-Demo](#live-demo)
- [Testaccounts](#testaccounts)
- [Kernfunktionen](#kernfunktionen)
- [Technologiestack](#technologiestack)
- [Architektur (Kurzüberblick)](#architektur-kurzüberblick)
- [Datenmodell (Kurzüberblick)](#datenmodell-kurzüberblick)
- [Projekt-/Code-Struktur](#projekt--code-struktur)
- [Konfiguration (Environment Variables)](#konfiguration-environment-variables)
- [Deployment / Betrieb (Render)](#deployment--betrieb-render)
- [Schnittstellen (interne JSON-APIs)](#schnittstellen-interne-json-apis)
- [Security-Hinweise](#security-hinweise)
- [Bekannte Einschränkungen](#bekannte-einschränkungen)
- [Dokumentation](#dokumentation)
- [Team](#team)

---

## Live-Demo
**URL:** https://geschenkkiste.onrender.com/

Hinweis: Auf Render kann es nach Inaktivität zu einem **Cold Start** kommen. Der erste Aufruf kann dadurch länger dauern (teils bis zu einigen Minuten). Danach sind die Seitenaufrufe i. d. R. deutlich schneller.

---

## Testaccounts
Für Abnahme/Demo können folgende Accounts genutzt werden (alternativ ist Registrierung möglich):

| Username  | E-Mail         | Passwort |
|----------|-----------------|----------|
| TestUser1 | User1@test.de   | Test1GK  |
| TestUser2 | User2@test.de   | Test2GK  |
| TestUser3 | User3@test.de   | Test3GK  |

> Tipp zur Prüfung der Datenisolation: Mit **zwei getrennten Accounts** testen, ob User A niemals private Daten von User B sieht.

---

## Kernfunktionen
- **Authentifizierung & Sessions**
  - Registrierung/Login/Logout
  - Session-basiertes Login (Cookie)
  - Passwort-Hashing via **bcrypt**
- **Datenisolation pro User**
  - User sieht ausschließlich eigene Daten (`createdBy`) + öffentliche Katalogdaten (`isPublic=true`)
- **Personenverwaltung**
  - Person anlegen/bearbeiten/löschen
  - Geburtstag (Tag+Monat), Notizen, Interessen
- **Anlässe & Eventlogik**
  - Standard-Anlässe: **Geburtstag** & **Weihnachten**
  - Weitere Anlässe anlegbar (fest / beweglich; einmalig / wiederkehrend)
  - **Automatische Event-Generierung** pro Jahr (idempotent, keine Duplikate)
  - **Tasks** für bewegliche Anlässe, wenn pro Jahr noch kein Datum gepflegt ist
- **Geschenke / Geschenkideen**
  - Geschenk-Katalog (öffentlich + eigene Geschenke)
  - Geschenk einem Event zuordnen (GiftAssignment) mit Status („Idee“ / „fertig“)
  - Upload von Bildern (mit Limits)
- **Historie**
  - „Fertig“ verschenkte Zuordnungen werden als Historie sichtbar (pro Person)
- **Vorschläge**
  - Serverseitige Vorschläge pro Event basierend auf Interessen + Historie + Nutzung (GiftUsage)
- **To‑Dos & Reminder**
  - In‑App To‑Do‑Übersicht (fehlende Daten / anstehende Events)
  - Optional: Reminder E‑Mails (SMTP/Nodemailer; best-effort)
- **Sharing**
  - Tokenbasierte **read-only** Links für Personen- und Eventansichten (ohne Login)
- **Alle Daten / HTML‑Übersicht**
  - Gesamtansicht mit Filtern (für Überblick/Export-ähnliche Nutzung)

---

## Technologiestack
- **Backend:** Node.js, Express.js
- **Rendering:** Server Side Rendering (SSR) via **EJS**
- **Datenbank:** MongoDB Atlas + **Mongoose (ODM)**
- **Hosting:** Render (Web Service)
- **E-Mail (optional):** Nodemailer
- **Sonstiges:** Middleware-Chain, Utilities, Seeds (Katalogdaten)

---

## Architektur (Kurzüberblick)
- **Browser** ruft Seiten auf (GET) oder sendet Formulare (POST/PUT/PATCH/DELETE).
- **Express** verarbeitet Requests über Routes + Middleware:
  - Auth/Session Guard
  - Validierung/Sanitization
  - Zeithorizont-Event-Synchronisation (bei eingeloggten GET-Requests)
- **MongoDB Atlas** speichert alle Daten; Zugriff via Mongoose.
- **Views (EJS)** werden serverseitig gerendert und als HTML ausgeliefert.
- **Client-JS** wird nur punktuell für UI-Interaktionen verwendet (kein SPA).

---

## Datenmodell (Kurzüberblick)
Wichtige Collections/Entitäten:
- `User`
- `Person`
- `Occasion` (Anlass-Vorlage)
- `PersonOccasion` (Verknüpfung Person ↔ Anlass inkl. Zeitraum)
- `Event` (konkreter Termin pro Jahr)
- `Gift` (Geschenk)
- `GiftAssignment` (Gift ↔ Event inkl. Status/Notizen)
- `Task` (fehlendes Datum bei beweglichen Anlässen)
- `Interest`
- `GiftInterestLink` (Overlay Gift ↔ Interest, v. a. für Kataloggeschenke)
- `GiftUsage` (userbezogene Nutzungshäufigkeit)
- `ShareToken` (Sharing per Link)

Konsistenz wird u. a. über **Unique-Indizes** abgesichert (z. B. PersonOccasion pro User nur einmal; Event je PersonOccasion+Jahr nur einmal; GiftAssignment je Gift+Event nur einmal).

---

## Projekt-/Code-Struktur
(MVC-ähnlicher Aufbau)

- `src/models` – Mongoose Schemas/Modelle
- `src/controllers` – Request-Handling & Businesslogik (Status, Vorschläge, Sharing, Reminder)
- `src/routes` – Express-Routen
- `src/middleware` – Auth-Guards, Horizon-Event-Sync, zentrale Checks
- `src/lib` – Utilities (z. B. URL-Normalisierung, Datumshilfen)
- `views/` – EJS Templates + Partials
- `public/` – Statische Assets (CSS/JS/Icons) + Uploads (`public/uploads/...`)
- `seed-data/` / `scripts/` – Seed-Katalog & Import/Seed-Skripte

---

## Konfiguration (Environment Variables)
Die Laufzeitkonfiguration wird **ausschließlich über Environment Variables** gesetzt (lokal z. B. per `.env`, in Render über das Dashboard). **Zugangsdaten/Secrets werden nicht im Repository gespeichert.**

| Variable | Zweck |
| `APP_BASE_URL` | Erwartete Basis-URL (u. a. für Same-Origin/CSRF-Prüfung und absolute Links) |
| `MONGODB_URI` | Verbindung zu MongoDB Atlas |
| `SESSION_SECRET` | Signieren / Verschlüsseln der Session |
| `MAIL_USER` | SMTP User (z. B. Gmail Adresse) |
| `MAIL_APP_PASS` | SMTP App-Passwort / SMTP Passwort |
| `MAIL_FROM` | Absenderadresse (From) |
| `MAIL_REPORT_TO` | E-Mail-Adresse für den Versand der Report-Mail |

---

## Deployment / Betrieb (Render)
Die Anwendung wird als **Render Web Service** betrieben, die Datenhaltung erfolgt über **MongoDB Atlas**.

### Betriebskontext
- Öffentliche URL: https://geschenkkiste.onrender.com/
- Browser: aktuelle Versionen von Chrome/Edge/Firefox empfohlen
- Cookies müssen aktiviert sein (Session-Login)
- JavaScript wird für einzelne UI-Interaktionen benötigt (z. B. modale Dialoge, Kalender-Komfortfunktionen)

### Logs & Fehleranalyse
- Fehleranalyse erfolgt über die **Render Logs** (Deployments, Laufzeitfehler, Mailversand).
- Typische Hinweise aus dem Betrieb:
  - **Redirects auf Login** → Session/Authentifizierung oder Datenisolation
  - **403 bei POST/DELETE** → Same-Origin/CSRF-Prüfung schlägt fehl (APP_BASE_URL prüfen)
  - **keine Reminder-E-Mails** → SMTP-Konfiguration/Provider/Render-Scheduler prüfen

### Uploads (Bilder)
Bilder werden im Verzeichnis `public/uploads/...` auf dem Dateisystem des Render-Services gespeichert.  
**Wichtig:** Ohne Persistent Disk können Uploads bei Redeploy/Neustart verloren gehen.

### Reminder-Scheduler (E-Mail, best-effort)
Die Anwendung unterstützt Reminder E-Mails. Der Versand erfolgt serverseitig (Nodemailer/SMTP).  
Zeitsteuerung: täglicher Job um **08:00 Europe/Berlin**.

- **Monats-Reminder:** innerhalb des Versandfensters am Monatsanfang und pro Monat max. einmal (Tracking: `monthlyMailLastSentAt`)
- **Weihnachts-Reminder:** saisonal 15.11. bis 24.12., pro Kalenderwoche max. einmal (Tracking: `xmasMailLastSentAt` + ISO-Woche)

---

## Schnittstellen (interne JSON-APIs)
Für einzelne UI-/AJAX-Funktionen existieren interne JSON-Endpoints:

- `GET /api/calendar/month`
- `GET /api/gifts/options`
- `GET /api/interests/options`
- `GET /api/events/:id/assignments`

### Sharing-URLs (read-only)
Für das Teilen von Personen- und Eventansichten werden tokenbasierte Links generiert. Diese Links sind ohne Login aufrufbar und liefern ausschließlich **read-only** Darstellungen.

**Erzeugen (nur eingeloggte User):**
- `POST /share/event/:eventId` → erstellt/holt Token für ein Event
- `POST /share/person/:personId` → erstellt/holt Token für eine Person

**Ansehen (ohne Login, read-only):**
- `GET /share/event/:token`
- `GET /share/person/:token`

---

## Security-Hinweise
- **Passwortspeicherung:** Passwörter werden gehasht (bcrypt), niemals im Klartext gespeichert.
- **Session-Management:** Zugriff auf geschützte Bereiche erfolgt über serverseitig verwaltete Sessions.
  - Cookies: `httpOnly`; in Production zusätzlich `secure=true` und `sameSite=strict`
- **Datenisolation pro User:** Entitäten tragen `createdBy`; Abfragen/Änderungen werden serverseitig so gefiltert, dass User nur eigene Daten sowie öffentliche Katalogdaten (`isPublic=true`) sehen.
- **Input-Validierung & Sanitization:**
  - Pflichtfelder, Datumsregeln, URL-Normalisierung (nur http/https)
  - Sanitization von Icon-/Textfeldern
  - XSS-Vermeidung durch konsequentes Escaping (u. a. bei dynamischem `innerHTML` im Client)
  - Upload-Limits: max. 10 Bilder pro Geschenk, max. 5 MB pro Datei, nur Bildformate (`.jpg/.jpeg/.png/.webp/.gif` + MIME-Check)
- **CSRF-Schutz (pragmatisch):**
  - Schreibende Requests (POST/PUT/PATCH/DELETE) werden nur akzeptiert, wenn `Origin` bzw. `Referer` zur erwarteten Basis-URL passt (Same-Origin Check).
  - Ein klassisches CSRF-Token wird in der aktuellen Version nicht verwendet.

---

## Bekannte Einschränkungen
- **Render Cold Start:** Erste Anfrage nach Inaktivität kann deutlich länger dauern.
- **Scheduler-Zuverlässigkeit:** Reminder-Jobs laufen in Hosting-Umgebungen ggf. nicht zuverlässig (best-effort).
- **29.02 Sonderfall:** Bei Geburtstagen/festen Anlässen am 29.02 kann es in Nicht-Schaltjahren zu einem Roll-over (z. B. 01.03.) kommen.
- **Uploads in Demo:** Ohne Persistent Disk können Bilder nach Neustart/Deployment verloren gehen.
- **Mobile Nutzung:** Desktop-first; mobile Darstellung nur eingeschränkt getestet.
- **Share Links:** Standardmäßig ohne Ablaufdatum; Widerruf derzeit serverseitig möglich (ohne Management-UI).

---

## Dokumentation
Die Projektdokumentation umfasst:
- **Benutzerhandbuch** (Bedienung/FAQ)
- **Fachliche Dokumentation** (Prozesse, fachliche Konzepte, Geschäftsregeln)
- **Technische Dokumentation** (Architektur, Komponenten, Datenmodell, Schnittstellen, Security)
- **Betriebsdokumentation** (Deployment/Config/Betriebshinweise/Testaccounts)
- **Testabschlussbericht** (Teststrategie, Testobjekte, Protokolle, Fazit & Restrisiken)

---

## Team
- **Carina Meints** – Projektleitung, Dokumentation, Fullstack-Entwicklung  
- **Oana-Petronela Romila** – Frontend-Entwicklung, UI/UX, Risikomanagement  
- **Sandro Morandell** – Backend-Entwicklung, Datenbankanbindung, Qualitätsmanagement  
- **Alexander Reimer** – Testing, Anforderungsmanagement, Entwicklung
