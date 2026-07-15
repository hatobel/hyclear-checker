# Änderungen: Banner-Synchronisierung und Bubblegum-Kontrolle

## Ausgangsproblem

Der erste Live-Lauf zeigte bei Orangensaft und Pfirsich-Maracuja einen bereits deaktivierten Warenkorb-Button, aber ein unsichtbares und leeres Banner:

```json
{
  "bannerExists": true,
  "bannerVisible": false,
  "bannerText": "",
  "buttonDisabled": true,
  "buttonClasses": ["btn-inactive", "inactive"]
}
```

## Wahrscheinliche Ursachen

1. Die alte Stabilitätsprüfung konnte nach ungefähr zwei Sekunden enden, obwohl weitere AJAX-/DOM-Aktualisierungen noch ausstanden.
2. `document.querySelector()` las nur das erste passende Banner. Bei mehrfach gerendertem Desktop-/Mobile-Markup konnte dies ein verstecktes, leeres Element sein.

## Technische Änderungen

- Same-origin-XHR-/Fetch-Tracker wird vor `selectOption()` registriert.
- Warten auf 1,5 Sekunden Netzwerkruhe, maximal 15 Sekunden.
- DOM-Beobachtung mindestens 4 Sekunden.
- Bei inaktivem Button und fehlendem Bannertext bis zu 8 Sekunden Banner-Gnadenzeit.
- Alle Banner über `querySelectorAll()` erfassen.
- Sichtbares Banner statt erstem Banner priorisieren.
- Alle Warenkorb-Buttons erfassen und sichtbaren Button priorisieren.
- `waitDiagnostics.transitions[]` dokumentiert jede Zustandsänderung.
- `processingEvidence.networkWait` dokumentiert Netzwerkaktivität.

## Bubblegum-Kontrolle

- Neue Variante `bubblegum-control`, Dropdown-Wert `517`.
- Vor dem Bubblegum-Test wird zuerst Orangensaft (`518`) ausgewählt.
- Danach wird aktiv zurück zu Bubblegum gewechselt.
- Bubblegum wird in `latest.json` und im Workflow-Report angezeigt.
- `monitor: false` und `control: true` schließen Bubblegum aus:
  - `shouldNotify`
  - `changes`
  - `last-known.json`
  - allen Benachrichtigungen

## Automatisierte Tests

16 Tests bestanden, darunter:

- verzögerter Bannertext nach früh deaktiviertem Button
- zwei Banner, davon erstes versteckt und leer
- Wechsel von Orangensaft zurück zu Bubblegum
- Ausschluss der Kontrollvariante aus der Überwachungsdefinition
