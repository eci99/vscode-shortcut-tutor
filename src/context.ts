import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Three-valued logic: true/false, or undefined = "unknown".
 * Unknown context keys (e.g. set by extensions via setContext) cannot be
 * queried; expressions using them are treated as potentially relevant.
 */
type Tri = boolean | undefined;
type Expr = (ctx: Context) => Tri;

/** A single condition such as `editorHasSelection` or `editorLangId == python`. */
interface Atom {
  key: string;
  /** false if the condition appears negated (`!x`, `x != y`). */
  positive: boolean;
  expr: Expr;
}

interface ParsedWhen {
  expr: Expr;
  atoms: Atom[];
}

/** A value of `undefined` means the key is unknown. */
export class Context {
  constructor(private readonly values: Map<string, unknown>) {}

  has(key: string): boolean {
    return this.values.has(key) || key.startsWith('config.');
  }

  get(key: string): unknown {
    if (key.startsWith('config.')) {
      return vscode.workspace.getConfiguration().get(key.slice('config.'.length));
    }
    return this.values.get(key);
  }
}

// --- Parser for when clauses ---------------------------------------------

const TOKEN_RE =
  /\s*(\|\||&&|===|!==|==|!=|=~|<=|>=|<|>|!|\(|\)|'(?:[^'\\]|\\.)*'|not\s+in\b|[^\s!()&|=<>~']+)/y;

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  TOKEN_RE.lastIndex = 0;
  while (TOKEN_RE.lastIndex < src.length) {
    const start = TOKEN_RE.lastIndex;
    // Read the regex literal after =~ separately, since it may contain any character.
    if (tokens[tokens.length - 1] === '=~') {
      const m = /\s*(\/(?:[^/\\]|\\.)*\/[a-z]*)/y;
      m.lastIndex = start;
      const r = m.exec(src);
      if (r) {
        tokens.push(r[1]);
        TOKEN_RE.lastIndex = m.lastIndex;
        continue;
      }
    }
    const t = TOKEN_RE.exec(src);
    if (!t) {
      if (/^\s*$/.test(src.slice(start))) {
        break;
      }
      throw new Error(`Unexpected character in "${src}"`);
    }
    tokens.push(t[1].replace(/^not\s+in$/, 'not in'));
  }
  return tokens;
}

function literal(token: string): unknown {
  if (token.startsWith("'")) {
    return token.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  if (token === 'true') {
    return true;
  }
  if (token === 'false') {
    return false;
  }
  return token;
}

function and(a: Tri, b: Tri): Tri {
  return a === false || b === false ? false : a === undefined || b === undefined ? undefined : true;
}

function or(a: Tri, b: Tri): Tri {
  return a === true || b === true ? true : a === undefined || b === undefined ? undefined : false;
}

function compare(op: string, key: string, raw: string): Expr {
  const value = literal(raw);
  if (op === '=~') {
    const m = /^\/(.*)\/([a-z]*)$/s.exec(raw);
    const re = m ? new RegExp(m[1], m[2].replace(/[^imsu]/g, '')) : undefined;
    return (ctx) => {
      if (!ctx.has(key) || !re) {
        return undefined;
      }
      const v = ctx.get(key);
      return typeof v === 'string' && re.test(v);
    };
  }
  if (op === 'in' || op === 'not in') {
    return (ctx) => {
      if (!ctx.has(key) || typeof value !== 'string' || !ctx.has(value)) {
        return undefined;
      }
      const container = ctx.get(value);
      const item = String(ctx.get(key));
      const found = Array.isArray(container)
        ? container.includes(item)
        : typeof container === 'object' && container !== null && item in container;
      return op === 'in' ? found : !found;
    };
  }
  return (ctx) => {
    if (!ctx.has(key)) {
      return undefined;
    }
    const v = ctx.get(key);
    switch (op) {
      case '==':
      case '===':
        return typeof value === 'boolean' ? !!v === value : String(v ?? '') === String(value);
      case '!=':
      case '!==':
        return typeof value === 'boolean' ? !!v !== value : String(v ?? '') !== String(value);
      default: {
        const a = Number(v);
        const b = Number(value);
        if (Number.isNaN(a) || Number.isNaN(b)) {
          return false;
        }
        return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
      }
    }
  };
}

function parseWhen(src: string): ParsedWhen {
  const tokens = tokenize(src);
  const atoms: Atom[] = [];
  let negated = false;
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const parseOr = (): Expr => {
    let left = parseAnd();
    while (peek() === '||') {
      next();
      const l = left;
      const r = parseAnd();
      left = (ctx) => or(l(ctx), r(ctx));
    }
    return left;
  };

  const parseAnd = (): Expr => {
    let left = parseUnary();
    while (peek() === '&&') {
      next();
      const l = left;
      const r = parseUnary();
      left = (ctx) => and(l(ctx), r(ctx));
    }
    return left;
  };

  const parseUnary = (): Expr => {
    if (peek() === '!') {
      next();
      negated = !negated;
      const inner = parseUnary();
      negated = !negated;
      return (ctx) => {
        const v = inner(ctx);
        return v === undefined ? undefined : !v;
      };
    }
    return parsePrimary();
  };

  const parsePrimary = (): Expr => {
    const t = next();
    if (t === undefined) {
      throw new Error('Unexpected end');
    }
    if (t === '(') {
      const e = parseOr();
      if (next() !== ')') {
        throw new Error('Missing parenthesis');
      }
      return e;
    }
    if (t === 'true') {
      return () => true;
    }
    if (t === 'false') {
      return () => false;
    }
    const op = peek();
    if (op && ['==', '===', '!=', '!==', '=~', '<', '<=', '>', '>=', 'in', 'not in'].includes(op)) {
      next();
      const rhs = next();
      if (rhs === undefined) {
        throw new Error('Missing comparison value');
      }
      const expr = compare(op, t, rhs);
      atoms.push({ key: t, positive: !negated && !['!=', '!==', 'not in'].includes(op), expr });
      return expr;
    }
    const expr: Expr = (ctx) => (ctx.has(t) ? !!ctx.get(t) : undefined);
    atoms.push({ key: t, positive: !negated, expr });
    return expr;
  };

  const expr = parseOr();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token "${peek()}"`);
  }
  return { expr, atoms };
}

const cache = new Map<string, ParsedWhen>();

function parsed(when: string): ParsedWhen {
  let p = cache.get(when);
  if (!p) {
    try {
      p = parseWhen(when);
    } catch {
      p = { expr: () => undefined, atoms: [] };
    }
    cache.set(when, p);
  }
  return p;
}

/** false only if the condition definitely does not hold in the current context. */
export function isRelevant(when: string | undefined, ctx: Context): boolean {
  return !when || parsed(when).expr(ctx) !== false;
}

/**
 * Context keys that appear non-negated in the when clause and currently hold,
 * i.e. the reason why the shortcut applies *right now*.
 */
export function matchingKeys(when: string | undefined, ctx: Context): string[] {
  if (!when) {
    return [];
  }
  const p = parsed(when);
  if (p.expr(ctx) === false) {
    return [];
  }
  return p.atoms.filter((a) => a.positive && a.expr(ctx) === true).map((a) => a.key);
}

// --- Build the current context from the API -------------------------------

/**
 * Short-lived UI states (open widgets, snippet mode, …). None of them are open
 * while looking at the shortcut view, so they count as false.
 */
const TRANSIENT_KEYS = [
  'inQuickOpen',
  'suggestWidgetVisible',
  'suggestWidgetMultipleSuggestions',
  'parameterHintsVisible',
  'parameterHintsMultipleSignatures',
  'findWidgetVisible',
  'findInputFocussed',
  'replaceInputFocussed',
  'renameInputVisible',
  'inSnippetMode',
  'hasNextTabstop',
  'hasPrevTabstop',
  'referenceSearchVisible',
  'inReferenceSearchEditor',
  'accessibleViewIsShown',
  'editorHoverVisible',
  'editorHoverFocused',
  'inlineSuggestionVisible',
  'codeActionMenuVisible',
  'markersNavigationVisible',
  'dirtyDiffVisible',
  'breadcrumbsActive',
  'notificationCenterVisible',
  'notificationToastsVisible',
];

/** Focus in areas other than the editor. */
const OTHER_FOCUS_KEYS = [
  'terminalFocus',
  'listFocus',
  'sideBarFocus',
  'panelFocus',
  'auxiliaryBarFocus',
  'filesExplorerFocus',
  'explorerViewletFocus',
  'searchViewletFocus',
];

export function buildContext(): Context {
  const v = new Map<string, unknown>();
  const editor = vscode.window.activeTextEditor;
  const notebook = vscode.window.activeNotebookEditor;
  const doc = editor?.document;
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

  v.set('isLinux', process.platform === 'linux');
  v.set('isMac', process.platform === 'darwin');
  v.set('isWindows', process.platform === 'win32');
  v.set('isWeb', vscode.env.uiKind === vscode.UIKind.Web);
  v.set('isIOS', false);

  const folders = vscode.workspace.workspaceFolders ?? [];
  v.set('workspaceFolderCount', folders.length);
  v.set('workbenchState', !folders.length ? 'empty' : vscode.workspace.workspaceFile ? 'workspace' : 'folder');

  v.set('editorIsOpen', !!activeTab);
  v.set('activeEditorGroupEmpty', !activeTab);
  v.set('multipleEditorGroups', vscode.window.tabGroups.all.length > 1);
  v.set('isInDiffEditor', activeTab?.input instanceof vscode.TabInputTextDiff);
  v.set('activeEditorIsDirty', !!activeTab?.isDirty);
  v.set('activeEditorIsPinned', !!activeTab?.isPinned);

  v.set('editorLangId', doc?.languageId ?? '');
  v.set('editorHasSelection', !!editor && !editor.selection.isEmpty);
  v.set('editorHasMultipleSelections', (editor?.selections.length ?? 0) > 1);
  v.set('notebookEditorOpen', !!notebook);

  const uri = doc?.uri ?? notebook?.notebook.uri;
  v.set('resourceLangId', doc?.languageId ?? '');
  v.set('resourceScheme', uri?.scheme ?? '');
  v.set('resource', uri?.toString() ?? '');
  v.set('resourcePath', uri?.path ?? '');
  v.set('resourceFilename', uri ? path.posix.basename(uri.path) : '');
  v.set('resourceExtname', uri ? path.posix.extname(uri.path) : '');
  v.set('resourceDirname', uri ? path.posix.dirname(uri.path) : '');
  v.set('isFileSystemResource', uri?.scheme === 'file');

  v.set('inDebugMode', !!vscode.debug.activeDebugSession);
  v.set('terminalIsOpen', vscode.window.terminals.length > 0);
  v.set('terminalCount', vscode.window.terminals.length);

  for (const key of TRANSIENT_KEYS) {
    v.set(key, false);
  }

  // The API does not reveal where focus is. The tips are about working in the
  // editor, so focus is assumed to be there.
  v.set('editorFocus', !!editor || !!notebook);
  v.set('editorTextFocus', !!editor);
  v.set('textInputFocus', !!editor);
  v.set('inputFocus', !!editor);
  v.set('notebookEditorFocused', !!notebook);
  for (const key of OTHER_FOCUS_KEYS) {
    v.set(key, false);
  }

  return new Context(v);
}
