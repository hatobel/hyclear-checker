# HyClear-Verfügbarkeitsmonitor

## Ziel

Der Monitor prüft die Rühl24-Varianten **Orangensaft** (`HyClear-Orange`, Dropdown-Wert `518`) und **Pfirsich-Maracuja** (`HyClear-Pfirsich-Maracuja`, Dropdown-Wert `521`) mit einem echten Chromium-Browser.

Eine normale HTTP-/HTML-Abfrage reicht nicht: Die generische Produktseite zeigt alle Dropdown-Optionen und immer „Lieferzeit: sofort“. Der variantspezifische Zustand entsteht erst nach dem JavaScript-`change`-Event.

## Sicherheitsprinzip: fail closed

Eine Sorte gilt nur als verfügbar, wenn alle folgenden Punkte erfüllt sind:

1. Dropdown-Wert entspricht der Zielvariante.
2. Ausgewähltes Label entspricht der Zielvariante.
3. Angezeigte Artikelnummer entspricht exakt der Zielvariante.
4. Das Nicht-auf-Lager-Banner ist nicht sichtbar.
5. Der Warenkorb-Button existiert, ist aktiv und besitzt weder `inactive` noch `btn-inactive`.

Bleibt versehentlich Bubblegum oder die allgemeine Artikelnummer `HyClear` aktiv, lautet das Ergebnis **nicht verifizierbar**, niemals verfügbar.

## Warum Playwright?

Playwright kann echte `<select>`-Optionen auswählen und löst dabei die relevanten DOM-Ereignisse aus. Nach der Auswahl wartet der Monitor auf einen über mehrere Messungen stabilen DOM-Zustand. Das verhindert, dass der vorherige Bubblegum-Zustand während einer laufenden AJAX-Aktualisierung ausgewertet wird.

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
```

## Internen Gambio-Request untersuchen

```bash
npm run discover
```

Das Skript öffnet Chromium sichtbar, wählt beide Sorten nacheinander aus und speichert ausschließlich die während des Wechsels ausgelösten `fetch`-/XHR-Requests. Damit lässt sich später prüfen, ob ein stabiler direkter API-Aufruf möglich ist.

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
