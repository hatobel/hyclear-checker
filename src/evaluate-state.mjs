import { OUT_OF_STOCK_TEXT } from './config.mjs';

export function evaluateVariantState(snapshot, variant, processingEvidence = {}) {
  const selectedValueMatches = snapshot.selectedValue === variant.value;
  const selectedLabelMatches = snapshot.selectedLabel === variant.label;
  const articleNumberMatches = snapshot.articleNumber === variant.articleNumber;

  // Rühl24 currently keeps the visible article number at the generic value
  // "HyClear" even after the variant update. Dropdown value and label are the
  // primary identity proof; the article number remains diagnostic only.
  const variantIdentityValid = selectedValueMatches && selectedLabelMatches;
  const serverProcessed = Boolean(
    articleNumberMatches ||
      processingEvidence.successfulVariantResponseObserved ||
      processingEvidence.relevantDomMutationObserved
  );

  const validation = {
    selectedValueMatches,
    selectedLabelMatches,
    articleNumberMatches,
    variantIdentityValid,
    serverProcessed,
    valid: variantIdentityValid
  };

  if (!variantIdentityValid) {
    return {
      status: 'unverifiable',
      validation,
      processingEvidence,
      reason:
        'Dropdown-Wert oder ausgewählte Sortenbezeichnung stimmt nicht mit der Zielvariante überein.'
    };
  }

  const visibleBannerTexts = Array.isArray(snapshot.visibleBannerTexts)
    ? snapshot.visibleBannerTexts
    : snapshot.bannerVisible
      ? [snapshot.bannerText]
      : [];
  const exactBanner = visibleBannerTexts.includes(OUT_OF_STOCK_TEXT);
  const inactiveButton =
    snapshot.buttonDisabled ||
    snapshot.buttonClasses.includes('inactive') ||
    snapshot.buttonClasses.includes('btn-inactive');

  // A disabled/inactive button or the exact stock banner is a safe negative
  // signal after the target option is selected. It is intentionally accepted
  // even if the shop does not expose the variant-specific article number.
  if (exactBanner || inactiveButton) {
    return {
      status: 'unavailable',
      validation,
      processingEvidence,
      reason: exactBanner
        ? 'Das sichtbare Nicht-auf-Lager-Banner wurde gefunden.'
        : 'Der Warenkorb-Button ist deaktiviert oder inaktiv.'
    };
  }

  const activeButton =
    snapshot.buttonExists &&
    snapshot.buttonVisible !== false &&
    !snapshot.bannerVisible &&
    !snapshot.buttonDisabled &&
    !snapshot.buttonClasses.includes('inactive') &&
    !snapshot.buttonClasses.includes('btn-inactive');

  // Positive results need stronger evidence than negative ones. This prevents
  // the active initial Bubblegum state from being mistaken for a processed
  // target variant if the Gambio handler failed.
  if (activeButton && serverProcessed) {
    return {
      status: 'available',
      validation,
      processingEvidence,
      reason:
        'Zielvariante ausgewählt; Variantenverarbeitung nachgewiesen; kein Banner; Warenkorb-Button aktiv.'
    };
  }

  if (activeButton && !serverProcessed) {
    return {
      status: 'unverifiable',
      validation,
      processingEvidence,
      reason:
        'Der Warenkorb-Button ist aktiv, aber eine Verarbeitung der Zielvariante konnte nicht nachgewiesen werden.'
    };
  }

  return {
    status: 'unverifiable',
    validation,
    processingEvidence,
    reason: 'Der DOM-Zustand ist widersprüchlich oder unvollständig.'
  };
}
