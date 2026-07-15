import { OUT_OF_STOCK_TEXT } from './config.mjs';

export function evaluateVariantState(snapshot, variant) {
  const selectedValueMatches = snapshot.selectedValue === variant.value;
  const selectedLabelMatches = snapshot.selectedLabel === variant.label;
  const articleNumberMatches = snapshot.articleNumber === variant.articleNumber;

  const validation = {
    selectedValueMatches,
    selectedLabelMatches,
    articleNumberMatches,
    valid: selectedValueMatches && selectedLabelMatches && articleNumberMatches
  };

  if (!validation.valid) {
    return {
      status: 'unverifiable',
      validation,
      reason: 'Die Zielvariante konnte nicht eindeutig validiert werden.'
    };
  }

  const exactBanner =
    snapshot.bannerVisible && snapshot.bannerText.trim() === OUT_OF_STOCK_TEXT;
  const inactiveButton =
    snapshot.buttonDisabled ||
    snapshot.buttonClasses.includes('inactive') ||
    snapshot.buttonClasses.includes('btn-inactive');

  if (exactBanner || inactiveButton) {
    return {
      status: 'unavailable',
      validation,
      reason: exactBanner
        ? 'Das sichtbare Nicht-auf-Lager-Banner wurde gefunden.'
        : 'Der Warenkorb-Button ist deaktiviert oder inaktiv.'
    };
  }

  if (
    snapshot.buttonExists &&
    !snapshot.bannerVisible &&
    !snapshot.buttonDisabled &&
    !snapshot.buttonClasses.includes('inactive') &&
    !snapshot.buttonClasses.includes('btn-inactive')
  ) {
    return {
      status: 'available',
      validation,
      reason: 'Zielvariante validiert; kein Banner; Warenkorb-Button aktiv.'
    };
  }

  return {
    status: 'unverifiable',
    validation,
    reason: 'Der DOM-Zustand ist widersprüchlich oder unvollständig.'
  };
}
