import * as vscode from 'vscode';
import { EXERCISES, Exercise, matches, parseState, State } from './exercises';

const SEPARATOR = '// ' + '─'.repeat(40);
/** Up to this many edits and keyboard cursor moves still count as "done with a shortcut". */
const MAX_EVENTS = 4;
/** Tasks per round, picked at random. */
const ROUND = 14;
/** How long the result stays visible before the next task appears. */
const RESULT_DELAY = 10_000;
/** True while a result is shown; enables the "next task" key binding. */
const RESULT_CONTEXT = 'shortcutTutor.practiceResult';

const resultDecoration = (background: string, color: string) =>
  vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor(background),
    after: { color: new vscode.ThemeColor(color), margin: '0 0 0 2em', fontWeight: 'bold' },
  });

type Describe = (command: string) => { title: string; key: string; conflicts?: string[] } | undefined;

/**
 * A practice session in an untitled editor: the comment header shows the task,
 * the body below the separator is checked against the task's goal.
 * shortcut: event-count heuristic, workbench tasks cannot tell mouse from keyboard; upgrade only if VS Code exposes command events
 */
class PracticeSession implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private index = 0;
  private events = 0;
  private mouse = false;
  private retried = false;
  private busy = false;
  private readonly clean = new Set<string>();
  private resultTimer?: NodeJS.Timeout;
  /** Moves on after a shown result; set only while the result is visible. */
  private pendingNext?: () => void;
  private readonly success = resultDecoration('diffEditor.insertedLineBackground', 'testing.iconPassed');
  private readonly retry = resultDecoration('inputValidation.warningBackground', 'editorWarning.foreground');

  constructor(
    readonly doc: vscode.TextDocument,
    private readonly exercises: Exercise[],
    private readonly describe: Describe,
    private readonly markKnown: (command: string) => void,
    private readonly onEnd: () => void,
    private readonly again: () => void,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === doc && !this.busy && e.contentChanges.length) {
          this.events++;
          this.check();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor.document !== doc || this.busy) {
          return;
        }
        if (e.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
          this.mouse = true;
        } else if (e.kind === vscode.TextEditorSelectionChangeKind.Keyboard) {
          this.events++;
        }
        this.check();
      }),
      vscode.window.onDidOpenTerminal(() => this.event('terminal')),
      // A fold splits the visible lines into several ranges.
      vscode.window.onDidChangeTextEditorVisibleRanges(
        (e) => e.textEditor.document === doc && e.visibleRanges.length > 1 && this.event('fold'),
      ),
      vscode.window.tabGroups.onDidChangeTabGroups((e) => e.opened.length && this.event('split')),
      vscode.window.onDidChangeActiveTextEditor((e) => e?.document.uri.scheme === 'file' && this.event('quickOpen')),
      vscode.workspace.onDidOpenTextDocument((d) => d !== doc && d.isUntitled && this.event('newFile')),
      vscode.workspace.onDidCloseTextDocument((d) => d === doc && this.dispose()),
      this.success,
      this.retry,
    );
  }

  dispose(): void {
    clearTimeout(this.resultTimer);
    vscode.commands.executeCommand('setContext', RESULT_CONTEXT, false);
    this.disposables.forEach((d) => d.dispose());
    this.onEnd();
  }

  private get current(): Exercise | undefined {
    return this.exercises[this.index];
  }

  async show(note = ''): Promise<void> {
    const ex = this.current;
    if (!ex) {
      return this.finish();
    }
    this.busy = true;
    // The hint depends on the context of the practice editor, so it must be active.
    await vscode.window.showTextDocument(this.doc, { preview: false });
    const info = this.describe(ex.command)!;
    const start = ex.start ? parseState(ex.start) : { text: '', ranges: [] };
    const header = [
      `// Shortcut practice ${this.index + 1}/${this.exercises.length}${note ? ` – ${note}` : ''}`,
      `// Task: ${ex.task}`,
      `// Hint: ${info.key}  (${info.title})`,
      ...(info.conflicts?.length
        ? [`// ⚠ ${info.key} is also bound to: ${info.conflicts.join(', ')}. If it does something else, change it in Keyboard Shortcuts.`]
        : []),
      SEPARATOR,
    ];
    const editor = await this.replace([...header, start.text].join('\n'));
    if (editor) {
      const pos = (offset: number) => {
        const before = start.text.slice(0, offset).split('\n');
        return new vscode.Position(header.length + before.length - 1, before[before.length - 1].length);
      };
      editor.selections = start.ranges.length
        ? start.ranges.map(([a, b]) => new vscode.Selection(pos(a), pos(b)))
        : [new vscode.Selection(pos(0), pos(0))];
      editor.revealRange(new vscode.Range(0, 0, 0, 0));
    }
    this.events = 0;
    this.mouse = false;
    this.busy = false;
  }

  /** Replaces the whole document and returns its editor, brought to the front. */
  private async replace(content: string): Promise<vscode.TextEditor | undefined> {
    const editor = await vscode.window.showTextDocument(this.doc, { preview: false });
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.doc.uri, new vscode.Range(0, 0, this.doc.lineCount, 0), content);
    await vscode.workspace.applyEdit(edit);
    return editor;
  }

  /** The body below the separator with its selections, or undefined if the separator was removed. */
  private state(editor: vscode.TextEditor): State | undefined {
    const doc = this.doc;
    let line = 0;
    while (line < doc.lineCount && doc.lineAt(line).text !== SEPARATOR) {
      line++;
    }
    if (line >= doc.lineCount - 1) {
      return undefined;
    }
    const bodyStart = new vscode.Position(line + 1, 0);
    // Offsets with "\n" line ends, whatever the document uses.
    const offset = (pos: vscode.Position) =>
      pos.isBefore(bodyStart) ? -1 : doc.getText(new vscode.Range(bodyStart, pos)).replace(/\r\n/g, '\n').length;
    return {
      text: doc.getText(new vscode.Range(bodyStart, doc.lineAt(doc.lineCount - 1).range.end)).replace(/\r\n/g, '\n'),
      ranges: editor.selections.map((s) => [offset(s.start), offset(s.end)]),
    };
  }

  private check(): void {
    const ex = this.current;
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === this.doc);
    const state = editor && ex?.goal && this.state(editor);
    if (state && matches(state, ex!.goal!)) {
      this.solved(!this.mouse && this.events <= (ex!.maxEvents ?? MAX_EVENTS));
    }
  }

  private event(kind: Exercise['event']): void {
    if (!this.busy && this.current?.event === kind) {
      this.solved(true);
    }
  }

  private async solved(clean: boolean): Promise<void> {
    const ex = this.current!;
    this.busy = true;
    if (clean) {
      this.clean.add(ex.command);
    }
    const repeat = !clean && !this.retried;
    // Workbench tasks move the focus away – bring the practice editor back to show the result.
    const editor = await vscode.window.showTextDocument(this.doc, { preview: false });
    const key = this.describe(ex.command)!.key;
    // The whole editor turns green (or yellow), the first line says why.
    const message = `${clean ? `✓ Done with ${key}!` : repeat ? `Solved – now try it with ${key}` : 'Solved'}   (Enter: next)`;
    editor.setDecorations(clean ? this.success : this.retry, [
      { range: new vscode.Range(0, 0, 0, 0), renderOptions: { after: { contentText: message } } },
      ...(this.doc.lineCount > 1 ? [{ range: new vscode.Range(1, 0, this.doc.lineCount - 1, 0) }] : []),
    ]);
    this.pendingNext = () => {
      this.pendingNext = undefined;
      clearTimeout(this.resultTimer);
      vscode.commands.executeCommand('setContext', RESULT_CONTEXT, false);
      editor.setDecorations(this.success, []);
      editor.setDecorations(this.retry, []);
      if (repeat) {
        this.retried = true;
        this.show(`try it with ${key}`);
        return;
      }
      this.retried = false;
      this.index++;
      this.show();
    };
    vscode.commands.executeCommand('setContext', RESULT_CONTEXT, true);
    this.resultTimer = setTimeout(() => this.pendingNext?.(), RESULT_DELAY);
  }

  /** Skips the rest of the result pause. */
  next(): void {
    this.pendingNext?.();
  }

  private async finish(): Promise<void> {
    const done = [...this.clean];
    this.dispose();
    // Close without the "Save?" prompt of an untitled editor.
    await vscode.window.showTextDocument(this.doc);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    const learn = 'Mark them as learned';
    const more = `${ROUND} more`;
    let choice = await vscode.window.showInformationMessage(
      `Practice done: ${done.length} of ${this.exercises.length} tasks solved with the shortcut.`,
      ...(done.length ? [learn] : []),
      more,
    );
    if (choice === learn) {
      done.forEach((c) => this.markKnown(c));
      choice = await vscode.window.showInformationMessage(`${done.length} shortcuts marked as learned.`, more);
    }
    if (choice === more) {
      this.again();
    }
  }
}

let session: PracticeSession | undefined;

export function practiceNext(): void {
  session?.next();
}

export async function startPractice(describe: Describe, markKnown: (command: string) => void): Promise<void> {
  if (session) {
    await vscode.window.showTextDocument(session.doc);
    return;
  }
  // An own language: no formatter or linter touches the practice text, but "//" comments and brackets work.
  const doc = await vscode.workspace.openTextDocument({ language: 'shortcut-practice', content: '' });
  // Shown first: which shortcuts apply depends on the active editor.
  await vscode.window.showTextDocument(doc, { preview: false });
  // Tasks whose command has no shortcut (e.g. removed by the user) cannot be practiced.
  const exercises = shuffle(EXERCISES.filter((e) => describe(e.command))).slice(0, ROUND);
  if (!exercises.length) {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    vscode.window.showWarningMessage('No practice tasks: none of their commands has a shortcut.');
    return;
  }
  session = new PracticeSession(
    doc,
    exercises,
    describe,
    markKnown,
    () => (session = undefined),
    () => startPractice(describe, markKnown),
  );
  await session.show();
}

/** Fisher–Yates: a random order, every order equally likely. */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
