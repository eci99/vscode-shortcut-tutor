import * as vscode from 'vscode';

/**
 * Keyboard layouts for labeling scan-code keys such as "[Equal]". VS Code writes
 * a default binding this way when the key cannot be expressed as a character on
 * the current layout; the extension API does not reveal that layout, so the user
 * picks it (or it is guessed from the system locale). Keys are lowercased
 * KeyboardEvent.code values; each layout only lists what differs from US.
 */

const US: Record<string, string> = {
  backquote: '`', minus: '-', equal: '=', bracketleft: '[', bracketright: ']', backslash: '\\',
  semicolon: ';', quote: "'", comma: ',', period: '.', slash: '/', intlbackslash: '<', intlro: '/', intlyen: '¥',
  space: 'Space', enter: 'Enter', tab: 'Tab', escape: 'Esc', backspace: '⌫', delete: 'Del',
  arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
  numpadadd: 'Num +', numpadsubtract: 'Num -', numpadmultiply: 'Num *', numpaddivide: 'Num /',
  numpaddecimal: 'Num .', numpadenter: 'Num Enter',
};
for (let i = 0; i <= 9; i++) {
  US[`digit${i}`] = String(i);
  US[`numpad${i}`] = `Num ${i}`;
}
for (const c of 'abcdefghijklmnopqrstuvwxyz') {
  US[`key${c}`] = c.toUpperCase();
}

const DE_LETTERS = { semicolon: 'Ö', quote: 'Ä', bracketleft: 'Ü', keyy: 'Z', keyz: 'Y' };

export const LAYOUTS: Record<string, { name: string; keys: Record<string, string> }> = {
  us: { name: 'English (US)', keys: {} },
  uk: { name: 'English (UK)', keys: { backslash: '#', intlbackslash: '\\' } },
  de: {
    name: 'German',
    keys: { ...DE_LETTERS, backquote: '^', minus: 'ß', equal: '´', bracketright: '+', backslash: '#', slash: '-' },
  },
  'ch-de': {
    name: 'Swiss German',
    keys: { ...DE_LETTERS, backquote: '§', minus: "'", equal: '^', bracketright: '¨', backslash: '$', slash: '-' },
  },
  fr: {
    name: 'French (AZERTY)',
    keys: {
      backquote: '²', digit1: '&', digit2: 'É', digit3: '"', digit4: "'", digit5: '(', digit6: '-', digit7: 'È',
      digit8: '_', digit9: 'Ç', digit0: 'À', minus: ')', bracketleft: '^', bracketright: '$', backslash: '*',
      semicolon: 'M', quote: 'Ù', keyq: 'A', keya: 'Q', keyw: 'Z', keyz: 'W', keym: ',', comma: ';', period: ':', slash: '!',
    },
  },
  es: {
    name: 'Spanish',
    keys: { backquote: 'º', minus: "'", equal: '¡', bracketleft: '`', bracketright: '+', backslash: 'Ç', semicolon: 'Ñ', quote: '´', slash: '-' },
  },
  it: {
    name: 'Italian',
    keys: { backquote: '\\', minus: "'", equal: 'Ì', bracketleft: 'È', bracketright: '+', backslash: 'Ù', semicolon: 'Ò', quote: 'À', slash: '-' },
  },
  sv: {
    name: 'Swedish / Finnish',
    keys: { backquote: '§', minus: '+', equal: '´', bracketleft: 'Å', bracketright: '¨', backslash: "'", semicolon: 'Ö', quote: 'Ä', slash: '-' },
  },
};

/** Guesses the layout from the system locale, e.g. "de_DE.UTF-8" → German, "de_CH" → Swiss German. */
function guessFromLocale(): string {
  const locale = (process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '')
    .replace('_', '-')
    .toLowerCase();
  const [lang, region = ''] = locale.split(/[-.@]/);
  if (lang === 'de') return region === 'ch' ? 'ch-de' : 'de';
  if (lang === 'en') return ['gb', 'ie'].includes(region) ? 'uk' : 'us';
  if (lang === 'fr' && region !== 'ca' && region !== 'ch') return 'fr';
  if (lang === 'es') return 'es';
  if (lang === 'it') return 'it';
  if (lang === 'sv' || lang === 'fi') return 'sv';
  return 'us';
}

/** The layout in use: the setting, or the guess for "auto". */
export function activeLayout(): { id: string; name: string; auto: boolean } {
  const setting = vscode.workspace.getConfiguration('shortcutTutor').get<string>('keyboardLayout', 'auto');
  const id = LAYOUTS[setting] ? setting : guessFromLocale();
  return { id, name: LAYOUTS[id].name, auto: !LAYOUTS[setting] };
}

/** Scan code → label for the active layout. */
export function scanCodeLabels(): Record<string, string> {
  return { ...US, ...LAYOUTS[activeLayout().id].keys };
}
