/**
 * Learning areas. Built-in commands carry no category, so the area is derived
 * from the command id. Order matters: the first matching rule wins, and
 * "editing" comes last because it also catches all remaining editor.* commands.
 */
export interface Area {
  id: string;
  name: string;
  test: RegExp;
}

export const AREAS: Area[] = [
  { id: 'terminal', name: 'Terminal', test: /^(workbench\.action\.(terminal|createTerminal)|terminal\.)/ },
  { id: 'debug', name: 'Debugging', test: /^(workbench\.action\.debug|workbench\.debug|debug\.|editor\.debug)/ },
  { id: 'chat', name: 'Chat & AI', test: /^(workbench\.action\.chat|workbench\.panel\.chat|chat\.|inlinechat|github\.copilot)/i },
  { id: 'scm', name: 'Source Control', test: /^(git\.|scm\.|workbench\.scm|workbench\.view\.scm)/ },
  { id: 'notebook', name: 'Notebooks', test: /^(notebook\.|jupyter\.|interactive\.)/ },
  { id: 'search', name: 'Search', test: /^(workbench\.action\.(findInFiles|replaceInFiles)|search\.|workbench\.view\.search)/ },
  {
    id: 'files',
    name: 'Files & Explorer',
    test: /^(workbench\.action\.files\.|workbench\.files\.|explorer\.|filesExplorer\.|workbench\.explorer|workbench\.view\.explorer|renameFile|deleteFile|moveFileToTrash)/,
  },
  {
    id: 'code',
    name: 'Code Intelligence',
    test: /^editor\.action\.(format|organizeImports|rename|quickFix|refactor|sourceAction|codeAction|autoFix|fixAll|triggerSuggest|triggerParameterHints|inlineSuggest|inlineEdit|showHover|showDefinitionPreviewHover|insertSnippet)/,
  },
  {
    id: 'navigation',
    name: 'Navigation',
    test: /^(editor\.action\.(goTo|revealDefinition|revealDeclaration|peek|marker|referenceSearch|jumpToBracket|selectToBracket|nextCommentThread|previousCommentThread|showReferences|dirtydiff)|workbench\.action\.(quickOpen(?!\w*Editor)|showCommands|gotoLine|gotoSymbol|showAllSymbols|navigate|openRecent))/,
  },
  {
    id: 'window',
    name: 'Window & Settings',
    test: /^workbench\.action\.(openSettings|openGlobalSettings|openWorkspaceSettings|openGlobalKeybindings|openKeybindings|selectTheme|reloadWindow|newWindow|closeWindow|quit|showAboutDialog|configureLocale)/,
  },
  {
    id: 'layout',
    name: 'Editors & Layout',
    test: /^workbench\.action\.(toggle|zoom|focus|maximize|minimize|close|open|next|previous|split|moveEditor|moveActiveEditor|pinEditor|unpinEditor|reopenClosedEditor|keepEditor|navigateEditor|editorLayout|joinTwoGroups|evenEditorWidths|showAllEditors|showEditorsInActiveGroup|quickOpenPreviousRecentlyUsedEditor|quickOpenLeastRecentlyUsedEditor|firstEditor|lastEditor|openEditorAtIndex|newGroup|increaseViewSize|decreaseViewSize|compareEditor)|^workbench\.view\./,
  },
  {
    id: 'editing',
    name: 'Editing',
    test: /^(cursor|delete|undo|redo|tab$|outdent$|type$|expandLineSelection|actions\.find|closeFindWidget|toggleFind|editor\.)/,
  },
];

/** Order in which areas are offered for selection (most commonly useful first). */
const DISPLAY_ORDER = ['editing', 'navigation', 'code', 'search', 'files', 'layout', 'terminal', 'debug', 'scm', 'notebook', 'chat', 'window'];

export const AREAS_FOR_SELECTION: Area[] = [...AREAS].sort(
  (a, b) => DISPLAY_ORDER.indexOf(a.id) - DISPLAY_ORDER.indexOf(b.id),
);

const cache = new Map<string, Area | undefined>();

export function areaOf(command: string): Area | undefined {
  if (!cache.has(command)) {
    cache.set(command, AREAS.find((a) => a.test.test(command)));
  }
  return cache.get(command);
}
