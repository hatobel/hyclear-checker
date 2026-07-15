# HyClear-Verfügbarkeitsmonitor

## Ziel

Der Monitor prüft die Rühl24-Varianten **Orangensaft** (`HyClear-Orange`, Dropdown-Wert `518`) und **Pfirsich-Maracuja** (`HyClear-Pfirsich-Maracuja`, Dropdown-Wert `521`) mit einem echten Chromium-Browser. Zusätzlich wird **Bubblegum** (`517`) als positive Kontrollvariante geprüft. Bubblegum erscheint im JSON und Workflow-Report, beeinflusst aber weder `shouldNotify` noch Statusänderungen oder Benachrichtigungen.

Eine normale HTTP-/HTML-Abfrage reicht nicht: Die generische Produktseite zeigt alle Dropdown-Optionen und immer „Lieferzeit: sofort“. Der variantspezifische Zustand entsteht erst nach dem JavaScript-`change`-Event.

## Sicherheitsprinzip: fail closed

Eine Sorte gilt nur als verfügbar, wenn alle folgenden Punkte erfüllt sind:

1. Dropdown-Wert entspricht der Zielvariante.
2. Ausgewähltes Label entspricht der Zielvariante.
3. Das Nicht-auf-Lager-Banner ist nicht sichtbar.
4. Der sichtbare Warenkorb-Button existiert, ist aktiv und besitzt weder `inactive` noch `btn-inactive`.
5. Für ein positives Ergebnis ist zusätzlich eine variantspezifische Netzwerkantwort, DOM-Mutation oder passende Artikelnummer erforderlich.

Die allgemeine Artikelnummer `HyClear` wird nur diagnostisch gespeichert, da Rühl24 sie nach dem Variantenwechsel offenbar nicht zuverlässig aktualisiert. Bleibt versehentlich eine andere Dropdown-Option aktiv, lautet das Ergebnis **nicht verifizierbar**, niemals verfügbar.

## Warum Playwright?

Playwright kann echte `<select>`-Optionen auswählen und löst dabei die relevanten DOM-Ereignisse aus. Der Monitor registriert vor der Auswahl Listener für same-origin `fetch`-/XHR-Requests, wartet anschließend auf Netzwerkruhe und beobachtet den DOM-Zustand weiter. Ein Zustand muss mindestens vier Sekunden beobachtet und über mehrere Messungen stabil sein. Wird der Button bereits inaktiv, das Banner ist aber noch leer, erhält das Banner bis zu acht Sekunden Zeit für eine verzögerte Aktualisierung.


## Warum das Banner im ersten Live-JSON leer war

Der erste Live-Lauf enthielt gleichzeitig:

```json
{
  "bannerExists": true,
  "bannerVisible": false,
  "bannerText": "",
  "buttonDisabled": true,
  "buttonClasses": ["btn-inactive", "inactive"]
}
```

Dafür kommen zwei technische Ursachen infrage, die beide behoben wurden:

1. **Zu frühes Ende der Wartephase:** Die bisherige Logik beendete die Prüfung nach vier identischen Messungen im Abstand von 500 ms. Der Button konnte bereits deaktiviert sein, während Rühl24 den Bannertext erst später einsetzte.
2. **Mehrere passende Banner:** Die bisherige Logik verwendete `document.querySelector()` und damit ausschließlich das erste passende Element. Bei doppeltem Desktop-/Mobile-Markup kann das erste Banner versteckt und leer sein, während ein weiteres Banner sichtbar ist.

Die neue JSON-Ausgabe enthält deshalb zusätzlich:

- `bannerCount`
- `banners[]` mit Sichtbarkeit, Text, Klassen und Inline-Style
- `visibleBannerTexts[]`
- `buttonCount` und `buttons[]`
- `waitDiagnostics.exitReason`
- `waitDiagnostics.transitions[]` als zeitliche Zustandsänderungen
- `processingEvidence.networkWait` mit beobachteten und abgeschlossenen Requests

Damit lässt sich im nächsten Live-Lauf unterscheiden, ob der Text verzögert erschien, ein anderes Banner benutzt wurde oder Rühl24 im Headless-Browser tatsächlich nur den Button aktualisiert.

## Positive Kontrollvariante Bubblegum

Bubblegum ist beim Öffnen der Seite bereits ausgewählt. Der Monitor akzeptiert diesen Anfangszustand deshalb nicht direkt als positiven Test. Stattdessen wird im separaten Kontrolllauf:

1. zuerst Orangensaft (`518`) ausgewählt,
2. auf die Verarbeitung gewartet,
3. anschließend zurück auf Bubblegum (`517`) gewechselt,
4. erneut auf Netzwerkruhe und einen stabilen DOM-Zustand gewartet.

Das Ergebnis erscheint unter `variants[]` sowie zusammengefasst unter `controls[]`. Die Konfiguration enthält `monitor: false` und `control: true`; dadurch wird Bubblegum ausdrücklich von `last-known.json`, `changes`, `shouldNotify` und Benachrichtigungen ausgeschlossen.

## Nachvollziehbarkeit

Jeder Lauf erzeugt pro Sorte:

- vollständigen Screenshot
- finalen HTML-DOM
- aufgezeichnete XHR-/Fetch-Requests und Antworten
- strukturiertes Ergebnis in `status/latest.json`

Die Dateien liegen im GitHub-Actions-Artefakt `hyclear-diagnostics-...` und werden 14 Tage aufbewahrt.

## Offizielle Node-Paketquellen

Das Projekt lädt seine Node-Abhängigkeiten ausschließlich aus der offiziellen npm-Registry:

```text
https://registry.npmjs.org/
```

Verwendetes Paket:

- [`playwright`](https://www.npmjs.com/package/playwright) aus der offiziellen npm-Registry
- Playwright-Dokumentation: <https://playwright.dev/docs/intro>
- Node.js-Downloads: <https://nodejs.org/en/download>

Die Datei `.npmrc` fixiert die Registry. Der GitHub-Actions-Workflow bricht ab, falls `package-lock.json` interne OpenAI-, Artifactory- oder CAAS-URLs enthält. `npx --no-install` stellt außerdem sicher, dass nur die bereits durch `npm ci` installierte Playwright-Version ausgeführt wird.

## Lokaler Test

Voraussetzungen: Node.js 20 oder neuer.

```bash
npm ci --registry=https://registry.npmjs.org/
npx --no-install playwright install chromium
npm test
npm run check
```

Ergebnisse:

```text
status/latest.json
status/notification.md
artifacts/orange.png
artifacts/orange.html
artifacts/orange-network.json
artifacts/peach-passion-fruit.png
artifacts/peach-passion-fruit.html
artifacts/peach-passion-fruit-network.json
artifacts/bubblegum-control.png
artifacts/bubblegum-control.html
artifacts/bubblegum-control-network.json
```

## Internen Gambio-Request untersuchen

```bash
npm run discover
```

Das Skript öffnet Chromium sichtbar, wählt alle Ziel- und Kontrollvarianten nacheinander aus und speichert ausschließlich die während des Wechsels ausgelösten `fetch`-/XHR-Requests. Damit lässt sich später prüfen, ob ein stabiler direkter API-Aufruf möglich ist.

## GitHub Actions einrichten

1. Neues GitHub-Repository erstellen, vorzugsweise öffentlich, falls ChatGPT später `status/latest.json` lesen soll.
2. Inhalt dieses Ordners in das Repository kopieren.
3. Dateien committen und auf den Standardbranch pushen.
4. Unter **Actions → HyClear stock monitor → Run workflow** einen manuellen Probelauf starten.
5. Das Diagnose-Artefakt herunterladen und Screenshots sowie `status/latest.json` prüfen.

Der Workflow läuft täglich um **08:17 Uhr** und **19:17 Uhr** in `Europe/Berlin`. Die versetzten Minuten vermeiden die besonders belastete volle Stunde.

## ChatGPT-Prüfung wieder aktivieren

Nach dem ersten erfolgreichen Lauf ist bei einem öffentlichen Repository folgende Datei abrufbar:

```text
https://raw.githubusercontent.com/OWNER/REPOSITORY/BRANCH/status/latest.json
```

Die ChatGPT-Automation kann anschließend ausschließlich diese statische JSON-Datei prüfen. Der Browserteil läuft in GitHub Actions; ChatGPT muss das dynamische Dropdown nicht mehr selbst bedienen.

Sinnvolle ChatGPT-Regel:

- nur Einträge mit `status: "available"` melden
- Statusänderungen aus `changes` melden
- bei `unverifiable` schweigen
- `generatedAt` prüfen und bei einem Alter über 24 Stunden keine Verfügbarkeit behaupten

## Bekannte Grenzen

- Der Live-Shop konnte in der aktuellen Ausführungsumgebung nicht mit Chromium aufgerufen werden, da dort kein direkter Internetzugang für den Browser besteht.
- Die DOM-Logik wurde anhand der von dir gelieferten Banner-/Button-Strukturen automatisiert getestet.
- Der erste GitHub-Actions-Probelauf ist deshalb der entscheidende End-to-End-Test gegen Rühl24.
- Ändert Rühl24 Selektoren oder Artikelnummerndarstellung, liefert das Skript `unverifiable` und die Diagnose-Dateien zeigen die Ursache.

## Erkenntnis aus dem ersten Live-Lauf

Der erste öffentliche GitHub-Actions-Lauf am 15.07.2026 bestätigte:

- Playwright wählt Dropdown-Wert `518` und Label `Orangensaft` korrekt aus.
- Playwright wählt Dropdown-Wert `521` und Label `Pfirsich-Maracuja` korrekt aus.
- Bei beiden Varianten war der Warenkorb-Button `disabled` und trug `inactive btn-inactive`.
- Rühl24 ließ die sichtbare Artikelnummer trotzdem bei der generischen Angabe `HyClear`.

Die Artikelnummer wird deshalb nur noch als zusätzliche Diagnoseinformation verwendet. Ein sicherer negativer Zustand wird anhand der korrekt ausgewählten Dropdown-Variante und des deaktivierten Warenkorb-Buttons erkannt.

Positive Ergebnisse bleiben strenger: Bei einem aktiven Warenkorb-Button muss zusätzlich mindestens eine erfolgreiche variantspezifische Netzwerkantwort oder eine relevante DOM-Mutation nachgewiesen werden. Bubblegum wird als separate positive Kontrolle erst nach einem Wechsel zu Orangensaft und zurück geprüft und bleibt vollständig von Benachrichtigungen ausgeschlossen.
