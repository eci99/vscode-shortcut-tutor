import * as vscode from 'vscode';
import { Boost } from './useful';
import { fillLabel, reason } from './reasons';

/**
 * Detects workflows that would be faster with a shortcut. VS Code does not
 * report which commands are executed; only text changes, selection changes
 * (distinguishing mouse/keyboard) and editor switches are observable.
 */

const LINE_COMMENT: Record<string, string> = {};
for (const lang of ['python', 'shellscript', 'yaml', 'ruby', 'perl', 'r', 'powershell', 'dockerfile', 'makefile', 'toml', 'coffeescript', 'julia', 'elixir', 'nim']) {
  LINE_COMMENT[lang] = '#';
}
for (const lang of ['sql', 'lua', 'haskell', 'elm']) {
  LINE_COMMENT[lang] = '--';
}
for (const lang of ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'c', 'cpp', 'csharp', 'java', 'go', 'rust', 'php', 'swift', 'kotlin', 'scala', 'dart', 'jsonc', 'scss', 'less', 'groovy', 'fsharp', 'zig', 'vue', 'svelte']) {
  LINE_COMMENT[lang] = '//';
}
LINE_COMMENT['latex'] = '%';

interface NudgeState {
  count: number;
  last: number;
  reason: string;
}

/** Counts repeated events within a time window. */
class Streak {
  private count = 0;
  private last = 0;

  hit(windowMs: number): number {
    const now = Date.now();
    this.count = now - this.last <= windowMs ? this.count + 1 : 1;
    this.last = now;
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }
}

export class NudgeTracker implements vscode.Disposable {
  /** Most recently detected workflow, shown as a tip card in the view. */
  lastTip?: { command: string; reason: string; time: number };
  private readonly nudges = new Map<string, NudgeState>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly lastNotified = new Map<string, number>();
  private lastNotification = 0;

  private lastEdit = 0;
  private readonly verticalArrows = new Streak();
  private readonly horizontalArrows = new Streak();
  private readonly charDeletes = new Streak();
  private lastCursor?: vscode.Position;
  private mouseTimer?: NodeJS.Timeout;
  private lastLineDeletion?: { doc: string; lines: number; time: number };
  private recentEditors: { uri: string; time: number }[] = [];
  private openedFiles: { uri: string; time: number }[] = [];
  private readonly seenFiles = new Set<string>();

  constructor(
    private readonly onChange: () => void,
    private readonly describe: (command: string) => { title: string; key: string } | undefined,
    private readonly isKnown: (command: string) => boolean,
    private readonly markKnown: (command: string) => void,
  ) {
    for (const doc of vscode.workspace.textDocuments) {
      this.seenFiles.add(doc.uri.toString());
    }
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onTextChange(e)),
      vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e)),
      vscode.window.onDidChangeActiveTextEditor((e) => this.onActiveEditor(e)),
    );
  }

  dispose(): void {
    clearTimeout(this.mouseTimer);
    this.disposables.forEach((d) => d.dispose());
  }

  /** Current ranking bonuses; nudges fade out over the configured time. */
  boosts(): Map<string, Boost> {
    const general = reason('general').params;
    const ttl = general.nudgeTtl.value * 60 * 1000;
    const now = Date.now();
    const result = new Map<string, Boost>();
    for (const [command, n] of this.nudges) {
      const age = now - n.last;
      if (age > ttl) {
        this.nudges.delete(command);
        continue;
      }
      const bonus = general.nudgeBonus.value * (1 - age / ttl) + Math.min(n.count - 1, 3);
      result.set(command, { bonus, reason: n.count > 1 ? `${n.reason} (${n.count}×)` : n.reason });
    }
    return result;
  }

  /** Threshold of a reason, e.g. param('charDelete', 'count'). Window params in seconds/minutes are converted to ms. */
  private param(id: string, key: string): number {
    const p = reason(id).params[key];
    return p.unit === 's' ? p.value * 1000 : p.unit === 'min' ? p.value * 60 * 1000 : p.value;
  }

  private record(id: string): void {
    const r = reason(id);
    const command = r.command;
    if (!r.enabled || !command || this.isKnown(command) || !this.describe(command)) {
      return;
    }
    const label = fillLabel(r.label);
    const n = this.nudges.get(command);
    this.nudges.set(command, { count: (n?.count ?? 0) + 1, last: Date.now(), reason: label });
    this.lastTip = { command, reason: label, time: Date.now() };
    this.onChange();
    this.notify(command, label);
  }

  private async notify(command: string, reason: string): Promise<void> {
    if (!vscode.workspace.getConfiguration('shortcutTutor').get<boolean>('notifications', true)) {
      return;
    }
    const now = Date.now();
    if (
      now - this.lastNotification < this.param('general', 'tipInterval') ||
      now - (this.lastNotified.get(command) ?? 0) < this.param('general', 'tipPerCommand')
    ) {
      return;
    }
    const info = this.describe(command);
    if (!info) {
      return;
    }
    this.lastNotification = now;
    this.lastNotified.set(command, now);
    const choice = await vscode.window.showInformationMessage(
      `Tip: ${info.title} works with ${info.key}. (${reason})`,
      'Got it',
      'No more tips',
    );
    if (choice === 'Got it') {
      this.markKnown(command);
    } else if (choice === 'No more tips') {
      await vscode.workspace
        .getConfiguration('shortcutTutor')
        .update('notifications', false, vscode.ConfigurationTarget.Global);
    }
  }

  // --- Text changes --------------------------------------------------------

  private onTextChange(e: vscode.TextDocumentChangeEvent): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || e.document !== editor.document || e.reason !== undefined || e.contentChanges.length !== 1) {
      return;
    }
    this.lastEdit = Date.now();
    const change = e.contentChanges[0];
    const doc = e.document;

    // Many single characters deleted in a row.
    if (change.text === '' && change.rangeLength === 1) {
      if (this.charDeletes.hit(this.param('charDelete', 'window')) >= this.param('charDelete', 'count')) {
        this.charDeletes.reset();
        this.record('charDelete');
      }
    } else {
      this.charDeletes.reset();
    }

    const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const startsLine = change.range.start.character === 0;

    // Whole lines removed – remember them to detect a later paste as a "move".
    if (change.text === '' && startsLine && change.range.end.character === 0 && change.range.end.line > change.range.start.line) {
      this.lastLineDeletion = {
        doc: doc.uri.toString(),
        lines: change.range.end.line - change.range.start.line,
        time: Date.now(),
      };
      return;
    }

    // Whole lines inserted: a duplicate of adjacent lines, or previously cut lines?
    if (startsLine && change.text.endsWith(eol) && change.range.isEmpty) {
      const inserted = change.text.slice(0, -eol.length).split(eol);
      const first = change.range.start.line;
      const n = inserted.length;
      const linesAt = (from: number) =>
        from >= 0 && from + n <= doc.lineCount
          ? Array.from({ length: n }, (_, i) => doc.lineAt(from + i).text)
          : undefined;
      const same = (lines?: string[]) => !!lines && lines.every((l, i) => l === inserted[i]);
      if (inserted.some((l) => l.trim()) && (same(linesAt(first - n)) || same(linesAt(first + n)))) {
        this.record('duplicateLine');
        return;
      }
      const del = this.lastLineDeletion;
      if (del && del.doc === doc.uri.toString() && del.lines === n && Date.now() - del.time < this.param('moveLines', 'window')) {
        this.lastLineDeletion = undefined;
        this.record('moveLines');
      }
      return;
    }

    // Line comment typed by hand in front of existing code.
    const prefix = LINE_COMMENT[doc.languageId];
    if (prefix && change.text.length === 1 && change.rangeLength === 0) {
      const line = doc.lineAt(change.range.start.line).text;
      const indent = line.length - line.trimStart().length;
      const end = change.range.start.character + 1;
      const rest = line.slice(indent + prefix.length);
      if (line.startsWith(prefix, indent) && end === indent + prefix.length && rest.trim() && !rest.startsWith(prefix)) {
        this.record('commentByHand');
      }
    }
  }

  // --- Selection & cursor ------------------------------------------------------

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    const sel = e.selections[0];
    const prev = this.lastCursor;
    this.lastCursor = sel.active;

    if (e.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
      this.verticalArrows.reset();
      this.horizontalArrows.reset();
      // Dragging fires the event constantly – only evaluate the final selection.
      clearTimeout(this.mouseTimer);
      this.mouseTimer = setTimeout(() => this.onMouseSelection(e.textEditor), 400);
      return;
    }
    if (e.kind !== vscode.TextEditorSelectionChangeKind.Keyboard || !prev || !sel.isEmpty || e.selections.length > 1) {
      return;
    }
    // Typing moves the cursor too – that is not navigating.
    if (Date.now() - this.lastEdit < 100) {
      this.verticalArrows.reset();
      this.horizontalArrows.reset();
      return;
    }
    const dLine = Math.abs(sel.active.line - prev.line);
    const dChar = Math.abs(sel.active.character - prev.character);
    if (dLine === 1) {
      this.horizontalArrows.reset();
      if (this.verticalArrows.hit(this.param('arrowLines', 'window')) >= this.param('arrowLines', 'count')) {
        this.verticalArrows.reset();
        this.record('arrowLines');
      }
    } else if (dLine === 0 && dChar === 1) {
      this.verticalArrows.reset();
      if (this.horizontalArrows.hit(this.param('arrowChars', 'window')) >= this.param('arrowChars', 'count')) {
        this.horizontalArrows.reset();
        this.record('arrowChars');
      }
    } else {
      this.verticalArrows.reset();
      this.horizontalArrows.reset();
    }
  }

  private onMouseSelection(editor: vscode.TextEditor): void {
    if (editor !== vscode.window.activeTextEditor) {
      return;
    }
    const doc = editor.document;
    if (editor.selections.length > 1) {
      this.record('mouseCursors');
      return;
    }
    const sel = editor.selection;
    if (sel.isEmpty) {
      return;
    }
    const lastLine = doc.lineAt(doc.lineCount - 1);
    if (sel.start.isEqual(new vscode.Position(0, 0)) && sel.end.isEqual(lastLine.range.end) && doc.lineCount > 3) {
      this.record('mouseSelectAll');
      return;
    }
    const fullLines =
      sel.start.character === 0 &&
      sel.end.line > sel.start.line &&
      (sel.end.character === 0 || sel.end.character === doc.lineAt(sel.end.line).text.length);
    if (fullLines) {
      this.record('mouseLines');
    }
  }

  // --- Editor switches -----------------------------------------------------

  private onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.uri.scheme !== 'file') {
      return;
    }
    const uri = editor.document.uri.toString();
    const now = Date.now();

    if (!this.seenFiles.has(uri)) {
      this.seenFiles.add(uri);
      const window = this.param('manyFiles', 'window');
      this.openedFiles = [...this.openedFiles.filter((f) => now - f.time < window), { uri, time: now }];
      if (this.openedFiles.length >= this.param('manyFiles', 'count')) {
        this.openedFiles = [];
        this.record('manyFiles');
      }
    }

    // Back and forth between two files, e.g. 4 switches: A B A B A
    const length = this.param('pingPong', 'switches') + 1;
    this.recentEditors = [...this.recentEditors, { uri, time: now }].slice(-length);
    const [a, b] = this.recentEditors.map((e) => e.uri);
    if (
      this.recentEditors.length === length &&
      a !== b &&
      now - this.recentEditors[0].time < this.param('pingPong', 'window') &&
      this.recentEditors.every((e, i) => e.uri === (i % 2 === 0 ? a : b))
    ) {
      this.recentEditors = [];
      this.record('pingPong');
    }
  }
}
