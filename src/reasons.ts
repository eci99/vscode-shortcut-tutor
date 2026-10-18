import * as vscode from 'vscode';

/**
 * All reasons with their defaults. Users can override them via the
 * "shortcutTutor.reasons" setting (edited in the Reasons editor); only
 * differences from the defaults are stored there.
 */

export type ReasonKind = 'general' | 'focus' | 'essentials' | 'context' | 'signal' | 'nudge';

export interface Param {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  step?: number;
}

export interface Reason {
  id: string;
  kind: ReasonKind;
  /** Name in the editor. */
  name: string;
  /** How the reason is detected (read-only). */
  description: string;
  enabled: boolean;
  /** Text shown in the view; may contain {value}, {count} and {s} (plural suffix). */
  label: string;
  params: Record<string, Param>;
  /** kind "context": context keys that trigger the reason (read-only). */
  contextKeys?: string[];
  /** kind "context": bonus when one of the keys matches; kind "focus": bonus per command in a chosen area. */
  bonus?: number;
  /** kind "focus": ids of the areas the user wants to learn (see areas.ts). */
  areas?: string[];
  /** kind "signal"/"essentials": command → bonus or weight. */
  commands?: Record<string, number>;
  /** kind "nudge": suggested command. */
  command?: string;
}

/** What gets stored in the setting per reason. */
export interface ReasonOverride {
  enabled?: boolean;
  label?: string;
  bonus?: number;
  command?: string;
  commands?: Record<string, number>;
  areas?: string[];
  params?: Record<string, number>;
}

const SETTING = 'reasons';

const p = (label: string, value: number, unit?: string, step = 1, min = 0): Param => ({ label, value, unit, step, min });

const DEFAULTS: Reason[] = [
  {
    id: 'general',
    kind: 'general',
    name: 'General',
    description: 'Settings for the ranking and the tip notifications.',
    enabled: true,
    label: '',
    params: {
      maxEntries: p('Max. entries in “Useful Now”', 12),
      minScore: p('Min. score to be shown', 4),
      nudgeBonus: p('Bonus of a detected workflow', 10),
      nudgeTtl: p('Detected workflows fade out after', 120, 'min'),
      tipInterval: p('Min. time between two tips', 2, 'min'),
      tipPerCommand: p('Min. time between tips for the same command', 60, 'min'),
    },
  },
  {
    id: 'focus',
    kind: 'focus',
    name: 'Learning focus',
    description: 'Commands in the areas you want to learn get a bonus.',
    enabled: true,
    label: 'Focus: {value}',
    params: {},
    bonus: 6,
    areas: [],
  },
  {
    id: 'essentials',
    kind: 'essentials',
    name: 'Base importance',
    description: 'Curated weight per command. Commands at or above the threshold show “Essentials” when no other reason applies.',
    enabled: true,
    label: 'Essentials',
    params: { threshold: p('Show label from weight', 7) },
    commands: {
      'workbench.action.quickOpen': 10,
      'workbench.action.showCommands': 10,
      'editor.action.revealDefinition': 9,
      'editor.action.addSelectionToNextFindMatch': 8,
      'editor.action.rename': 8,
      'editor.action.quickFix': 8,
      'editor.action.moveLinesUpAction': 7,
      'editor.action.moveLinesDownAction': 7,
      'editor.action.commentLine': 7,
      'editor.action.formatDocument': 7,
      'workbench.action.gotoSymbol': 7,
      'actions.find': 7,
      'workbench.action.findInFiles': 7,
      'workbench.action.terminal.toggleTerminal': 7,
      'editor.action.copyLinesDownAction': 6,
      'editor.action.deleteLines': 6,
      'editor.action.insertCursorBelow': 6,
      'editor.action.selectHighlights': 6,
      'editor.action.goToReferences': 6,
      'workbench.action.gotoLine': 6,
      'workbench.action.navigateBack': 6,
      'editor.action.startFindReplaceAction': 6,
      'workbench.action.files.save': 6,
      'workbench.action.debug.start': 6,
      'editor.debug.action.toggleBreakpoint': 6,
      'editor.action.copyLinesUpAction': 5,
      'editor.action.insertCursorAbove': 5,
      'expandLineSelection': 5,
      'editor.action.smartSelect.expand': 5,
      'workbench.action.showAllSymbols': 5,
      'editor.action.marker.nextInFiles': 5,
      'workbench.action.closeActiveEditor': 5,
      'workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup': 5,
      'workbench.action.togglePanel': 5,
      'workbench.action.toggleSidebarVisibility': 5,
      'workbench.action.debug.stepOver': 5,
      'workbench.action.debug.continue': 5,
      'cursorWordLeft': 5,
      'cursorWordRight': 5,
      'deleteWordLeft': 5,
      'editor.action.triggerSuggest': 5,
      'editor.action.showHover': 4,
      'editor.action.peekDefinition': 4,
      'editor.action.insertLineAfter': 4,
      'workbench.action.navigateForward': 4,
      'workbench.action.reopenClosedEditor': 4,
      'workbench.action.splitEditor': 4,
      'workbench.action.replaceInFiles': 4,
      'workbench.action.debug.stepInto': 4,
      'workbench.action.debug.stop': 4,
      'workbench.view.explorer': 4,
      'editor.action.selectAll': 3,
      'editor.action.smartSelect.shrink': 3,
      'editor.action.blockComment': 3,
      'editor.action.triggerParameterHints': 3,
      'editor.action.jumpToBracket': 3,
      'editor.action.insertLineBefore': 3,
      'editor.action.indentLines': 3,
      'editor.action.outdentLines': 3,
      'cursorWordLeftSelect': 3,
      'cursorWordRightSelect': 3,
      'workbench.action.files.saveAll': 3,
      'workbench.action.debug.stepOut': 3,
      'workbench.action.compareEditor.nextChange': 3,
      'workbench.action.compareEditor.previousChange': 3,
      'editor.fold': 3,
      'editor.unfold': 3,
      'workbench.view.search': 3,
      'workbench.view.scm': 3,
      'workbench.action.openSettings': 3,
      'workbench.action.openGlobalKeybindings': 3,
      'markdown.showPreviewToSide': 3,
      'editor.foldAll': 2,
      'editor.unfoldAll': 2,
      'workbench.action.zoomIn': 2,
      'workbench.action.zoomOut': 2,
    },
  },

  // --- Situation from the shortcut's when clause --------------------------
  ...([
    ['textSelected', 'Text selected', 'Text is selected.', ['editorHasSelection'], 5],
    ['multipleCursors', 'Multiple cursors', 'More than one cursor is active.', ['editorHasMultipleSelections'], 5],
    ['debugging', 'Debugging', 'A debug session is running.', ['inDebugMode'], 6],
    ['diffEditor', 'Diff editor open', 'The active editor is a diff editor.', ['isInDiffEditor'], 6],
    ['language', 'Language: {value}', 'The shortcut only applies to the current language.', ['editorLangId', 'resourceLangId'], 4],
    ['fileType', 'File type {value}', 'The shortcut only applies to the current file extension.', ['resourceExtname'], 4],
    ['notebook', 'Notebook', 'A notebook is active.', ['notebookEditorFocused'], 4],
    ['unsavedContext', 'Unsaved changes', 'The active editor has unsaved changes.', ['activeEditorIsDirty'], 2],
    ['editorGroups', 'Multiple editor groups', 'More than one editor group is open.', ['multipleEditorGroups'], 2],
  ] as const).map(([id, label, description, contextKeys, bonus]): Reason => ({
    id,
    kind: 'context',
    name: label.replace(/[:\s]*\{value\}/, ''),
    description: `${description} Applies to shortcuts whose when clause requires it.`,
    enabled: true,
    label,
    params: {},
    contextKeys: [...contextKeys],
    bonus,
  })),

  // --- Situation signals -------------------------------------------------------
  {
    id: 'boosted',
    kind: 'signal',
    name: 'Boosted by you',
    description: 'Shortcuts you boosted with ★ in a learning focus section of the view. Always active.',
    enabled: true,
    label: 'Boosted',
    params: { boost: p('Bonus for newly boosted shortcuts', 8) },
    commands: {},
  },
  {
    id: 'unsaved',
    kind: 'signal',
    name: 'Unsaved changes',
    description: 'The active editor has unsaved changes.',
    enabled: true,
    label: 'Unsaved changes',
    params: {},
    commands: { 'workbench.action.files.save': 4 },
  },
  {
    id: 'problems',
    kind: 'signal',
    name: 'Problems in file',
    description: 'The active file has errors or warnings.',
    enabled: true,
    label: '{count} problem{s} in file',
    params: {},
    commands: { 'editor.action.marker.nextInFiles': 5, 'editor.action.quickFix': 5 },
  },
  {
    id: 'selection',
    kind: 'signal',
    name: 'Text selected',
    description: 'Text is selected in the active editor.',
    enabled: true,
    label: 'Text selected',
    params: {},
    commands: {
      'editor.action.addSelectionToNextFindMatch': 4,
      'editor.action.selectHighlights': 4,
      'editor.action.commentLine': 2,
      'editor.action.moveLinesUpAction': 2,
      'editor.action.moveLinesDownAction': 2,
    },
  },
  {
    id: 'longFile',
    kind: 'signal',
    name: 'Long file',
    description: 'The active file is long.',
    enabled: true,
    label: 'Long file',
    params: { lines: p('More than', 300, 'lines') },
    commands: { 'workbench.action.gotoSymbol': 4, 'workbench.action.gotoLine': 3, 'editor.foldAll': 3 },
  },
  {
    id: 'manyEditors',
    kind: 'signal',
    name: 'Many editors open',
    description: 'Many editor tabs are open.',
    enabled: true,
    label: 'Many editors open',
    params: { tabs: p('More than', 5, 'tabs') },
    commands: { 'workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup': 3, 'workbench.action.closeActiveEditor': 3 },
  },
  {
    id: 'terminal',
    kind: 'signal',
    name: 'Terminal open',
    description: 'At least one terminal is open.',
    enabled: true,
    label: 'Terminal open',
    params: {},
    commands: { 'workbench.action.terminal.toggleTerminal': 2 },
  },

  // --- Detected workflows (tips) ----------------------------------------------
  ...([
    ['duplicateLine', 'Duplicated a line via copy & paste', 'Inserted lines equal the lines right above or below.', 'editor.action.copyLinesDownAction', {}],
    ['moveLines', 'Moved lines via cut & paste', 'Whole lines were deleted and the same number of lines was inserted shortly after.', 'editor.action.moveLinesDownAction', { window: p('Paste within', 15, 's') }],
    ['commentByHand', 'Commented out a line by hand', 'A line comment marker was typed in front of existing code.', 'editor.action.commentLine', {}],
    ['charDelete', 'Deleted character by character', 'Many single characters were deleted in a row.', 'deleteWordLeft', { count: p('Deletions', 12), window: p('Max. pause between them', 1.5, 's', 0.1) }],
    ['arrowLines', 'Moved across many lines with arrow keys', 'The cursor was moved line by line many times in a row.', 'workbench.action.gotoLine', { count: p('Key presses', 20), window: p('Max. pause between them', 1.5, 's', 0.1) }],
    ['arrowChars', 'Moved through a line character by character', 'The cursor was moved character by character many times in a row.', 'cursorWordRight', { count: p('Key presses', 15), window: p('Max. pause between them', 1.5, 's', 0.1) }],
    ['mouseSelectAll', 'Selected all text with the mouse', 'The whole document was selected with the mouse.', 'editor.action.selectAll', {}],
    ['mouseLines', 'Selected whole lines with the mouse', 'Whole lines were selected with the mouse.', 'expandLineSelection', {}],
    ['mouseCursors', 'Placed multiple cursors with the mouse', 'Multiple cursors were placed with the mouse.', 'editor.action.insertCursorBelow', {}],
    ['manyFiles', 'Opened many files', 'Many files were opened that were not open before.', 'workbench.action.quickOpen', { count: p('Files', 6), window: p('Within', 5, 'min') }],
    ['pingPong', 'Switched back and forth between two files', 'The active editor alternated between the same two files.', 'workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup', { switches: p('Switches', 4, undefined, 1, 2), window: p('Within', 2, 'min') }],
  ] as const).map(([id, label, description, command, params]): Reason => ({
    id,
    kind: 'nudge',
    name: label,
    description,
    enabled: true,
    label,
    params: { ...params } as Record<string, Param>,
    command,
  })),
];

let cache: Map<string, Reason> | undefined;

function overrides(): Record<string, ReasonOverride> {
  return vscode.workspace.getConfiguration('shortcutTutor').get<Record<string, ReasonOverride>>(SETTING, {});
}

function apply(def: Reason, o: ReasonOverride | undefined): Reason {
  const r: Reason = structuredClone(def);
  if (!o) {
    return r;
  }
  if (typeof o.enabled === 'boolean') r.enabled = o.enabled;
  if (typeof o.label === 'string') r.label = o.label;
  if (typeof o.bonus === 'number') r.bonus = o.bonus;
  if (typeof o.command === 'string') r.command = o.command;
  if (o.commands && typeof o.commands === 'object') r.commands = { ...o.commands };
  if (Array.isArray(o.areas)) r.areas = [...o.areas];
  for (const [key, value] of Object.entries(o.params ?? {})) {
    if (r.params[key] && typeof value === 'number') r.params[key].value = value;
  }
  return r;
}

export function defaultReasons(): Reason[] {
  return structuredClone(DEFAULTS);
}

/** Current reasons including user overrides. */
export function getReasons(): Map<string, Reason> {
  if (!cache) {
    const o = overrides();
    cache = new Map(DEFAULTS.map((d) => [d.id, apply(d, o[d.id])]));
  }
  return cache;
}

export function reason(id: string): Reason {
  return getReasons().get(id)!;
}

/** Must be called when the setting changes. */
export function invalidateReasons(): void {
  cache = undefined;
}

/** Fills {value}, {count} and {s} in a label. */
export function fillLabel(label: string, vars: { value?: unknown; count?: number } = {}): string {
  return label
    .replace(/\{value\}/g, String(vars.value ?? ''))
    .replace(/\{count\}/g, String(vars.count ?? ''))
    .replace(/\{s\}/g, vars.count === 1 ? '' : 's');
}

/**
 * Stores only what differs from the default; an empty override removes the entry.
 * Returns false if nothing had to be written.
 */
export async function saveReason(id: string, value: ReasonOverride): Promise<boolean> {
  const def = DEFAULTS.find((d) => d.id === id);
  if (!def) {
    return false;
  }
  const diff: ReasonOverride = {};
  if (value.enabled !== undefined && value.enabled !== def.enabled) diff.enabled = value.enabled;
  if (value.label !== undefined && value.label !== def.label) diff.label = value.label;
  if (value.bonus !== undefined && value.bonus !== def.bonus) diff.bonus = value.bonus;
  if (value.command !== undefined && value.command !== def.command) diff.command = value.command;
  if (value.commands && JSON.stringify(value.commands) !== JSON.stringify(def.commands)) diff.commands = value.commands;
  if (value.areas && JSON.stringify([...value.areas].sort()) !== JSON.stringify([...(def.areas ?? [])].sort())) {
    diff.areas = value.areas;
  }
  const params: Record<string, number> = {};
  for (const [key, v] of Object.entries(value.params ?? {})) {
    if (def.params[key] && v !== def.params[key].value) params[key] = v;
  }
  if (Object.keys(params).length) diff.params = params;

  const all = { ...overrides() };
  if (Object.keys(diff).length) {
    all[id] = diff;
  } else {
    delete all[id];
  }
  return writeOverrides(all);
}

/** Resets one reason, or all without an id. Returns false if nothing had to be written. */
export async function resetReason(id?: string): Promise<boolean> {
  const all = { ...overrides() };
  if (id) {
    delete all[id];
  }
  return writeOverrides(id ? all : {});
}

async function writeOverrides(all: Record<string, ReasonOverride>): Promise<boolean> {
  if (JSON.stringify(all) === JSON.stringify(overrides())) {
    return false;
  }
  await vscode.workspace
    .getConfiguration('shortcutTutor')
    .update(SETTING, Object.keys(all).length ? all : undefined, vscode.ConfigurationTarget.Global);
  invalidateReasons();
  return true;
}
