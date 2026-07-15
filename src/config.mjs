export const PRODUCT_URL =
  'https://www.ruehl24.de/de/protein/whey-protein-isolat/HyClear-Whey-Protein-Hydrolysat.html';

export const SELECTOR = '#modifier_group_21';
export const BANNER_SELECTOR = '.cart-error-msg.alert.alert-danger';
export const CART_BUTTON_SELECTOR = 'button[name="btn-add-to-cart"]';
export const OUT_OF_STOCK_TEXT =
  'Der Artikel ist momentan nicht auf Lager, aber in Kürze wieder erhältlich.';

export const VARIANTS = [
  {
    key: 'orange',
    label: 'Orangensaft',
    value: '518',
    articleNumber: 'HyClear-Orange',
    monitor: true
  },
  {
    key: 'peach-passion-fruit',
    label: 'Pfirsich-Maracuja',
    value: '521',
    articleNumber: 'HyClear-Pfirsich-Maracuja',
    monitor: true
  },
  {
    key: 'bubblegum-control',
    label: 'Bubblegum',
    value: '517',
    articleNumber: 'HyClear-Bubblegum',
    monitor: false,
    control: true,
    // Bubblegum is the default selection. Select an unavailable option first so
    // the positive control proves that Gambio can also switch back to an active
    // variant instead of merely reading the initial page state.
    preselectValue: '518'
  }
];
