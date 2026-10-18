import * as vscode from 'vscode';
import { formatKey, loadShortcuts, Shortcut, userKeybindingsUri } from './keybindings';
import { activeLayout, scanCodeLabels } from './layouts';
import { buildContext, Context, isRelevant } from './context';
import { rankUseful } from './useful';
import { NudgeTracker } from './nudges';
import { invalidateReasons, reason, saveReason } from './reasons';
import { AREAS_FOR_SELECTION, areaOf } from './areas';
import { CommandInfo, ReasonsEditor } from './reasonsEditor';

const KNOWN_KEY = 'shortcutTutor.known';
/** Search results beyond this are left out to keep the view fast. */
const MAX_RESULTS = 100;

/** An entry as displayed by the webview. */
interface Entry {
  command: string;
  title: string;
  keys: string[];
  /** When clauses of the displayed bindings; "" for a binding that always applies. */
  whens: string[];
  reasons?: string[];
  known?: boolean;
  boosted?: boolean;
}

class ShortcutViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'shortcutTutor.view';
  private view?: vscode.WebviewView;
  private shortcuts: Shortcut[] = [];
  private updateTimer?: NodeJS.Timeout;
  private lastPayload = '';
  /** Search text from the view; while set, the view shows matching shortcuts instead of its lists. */
  private query = '';
  /**
   * Recorded key sequence from the view: per chord the modifiers and the accepted
   * spellings of the main key, e.g. [{ mods: ["ctrl"], mains: ["=", "[equal]"] }];
   * no mains (while only modifiers are held) means any main key.
   * While set, it replaces the search text.
   */
  private keys: RecordedChord[] = [];
  readonly nudges: NudgeTracker;

  constructor(private readonly context: vscode.ExtensionContext) {
    context.globalState.setKeysForSync([KNOWN_KEY]);
    this.nudges = new NudgeTracker(
      () => this.scheduleUpdate(),
      (command) => this.describe(command),
      (command) => this.known.has(command),
      (command) => this.setKnown(command, true),
    );
  }

  /** Commands the user has marked as "got it". */
  get known(): Set<string> {
    return new Set(this.context.globalState.get<string[]>(KNOWN_KEY, []));
  }

  async setKnown(command: string, known: boolean): Promise<void> {
    const set = this.known;
    if (known) {
      set.add(command);
    } else {
      set.delete(command);
    }
    await this.context.globalState.update(KNOWN_KEY, [...set]);
    this.update();
  }

  /** Title and readable key of a command, preferring the user's own binding. */
  describe(command: string): { title: string; key: string } | undefined {
    const bindings = this.shortcuts.filter((s) => s.command === command);
    const best = bindings.find((s) => s.source === 'user') ?? bindings[0];
    return best && { title: best.title, key: formatKey(best.key) };
  }

  /** Title and key of every command with a shortcut, for the Reasons editor. */
  commandInfo(): CommandInfo {
    const info: CommandInfo = {};
    for (const s of this.shortcuts) {
      if (!info[s.command]) {
        info[s.command] = this.describe(s.command)!;
      }
    }
    return info;
  }

  isVisible(): boolean {
    return !!this.view?.visible;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const mediaUri = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [mediaUri] };
    view.webview.html = this.html(view.webview, mediaUri);

    view.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
        case 'ready':
          this.lastPayload = '';
          this.update();
          break;
        case 'known':
          await this.setKnown(msg.command, msg.known);
          break;
        case 'edit':
          // "@command:" filters the Keyboard Shortcuts editor to exactly this command.
          await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', `@command:${msg.command}`);
          break;
        case 'dismissTip':
          this.nudges.lastTip = undefined;
          this.update();
          break;
        case 'chooseFocus':
          await chooseFocus();
          break;
        case 'boost':
          await setBoosted(msg.command, msg.boosted);
          break;
        case 'search':
          this.query = String(msg.query ?? '').trim().toLowerCase();
          this.keys = Array.isArray(msg.keys) ? msg.keys : [];
          this.update();
          break;
      }
    });
  }

  /** Loads the shortcuts even without an open view – the tips need them. */
  async refresh(): Promise<void> {
    this.shortcuts = await loadShortcuts(this.context);
    this.update();
  }

  private entry(command: string, ctx?: Context): Entry {
    const bindings = this.shortcuts.filter((s) => s.command === command && (!ctx || isRelevant(s.when, ctx)));
    return {
      command,
      title: bindings[0]?.title ?? command,
      keys: [...new Set(bindings.map((s) => s.key))],
      whens: [...new Set(bindings.map((s) => s.when ?? ''))],
    };
  }

  update(): void {
    if (!this.view || !this.shortcuts.length) {
      return;
    }
    const ctx = buildContext();
    const known = this.known;
    const last = this.nudges.lastTip;
    const tip = last && !known.has(last.command) ? { ...this.entry(last.command), reasons: [last.reason], time: last.time } : undefined;
    // The tip card already shows its command, so it is left out of the list below.
    const useful = rankUseful(this.shortcuts, ctx, known, this.nudges.boosts())
      .filter((u) => u.command !== tip?.command)
      .map((u) => ({
        ...this.entry(u.command, ctx),
        reasons: u.reasons,
      }));
    const learned = [...known]
      .map((command) => this.entry(command))
      .filter((e) => e.keys.length)
      .sort((a, b) => a.title.localeCompare(b.title));

    const focus = reason('focus');
    const focusAreas = focus.enabled ? AREAS_FOR_SELECTION.filter((a) => focus.areas?.includes(a.id)) : [];
    // All shortcuts of each chosen area, regardless of the current situation.
    const areaShortcuts = focusAreas.map((a) => ({
      id: a.id,
      name: a.name,
      entries: this.collect((s) => areaOf(s.command)?.id === a.id, known),
    }));
    // Every word must appear in the title, the command id or the key (as stored or as displayed).
    const words = this.query.split(/\s+/).filter(Boolean);
    const keys = this.keys;
    const results = keys.length
      ? // Exact matches first, then those that need more modifiers or further chords.
        (() => {
          const exact = this.collect((s) => matchesKeys(s.key, keys) === 'exact', known);
          const exactCommands = new Set(exact.map((e) => e.command));
          const more = this.collect((s) => !!matchesKeys(s.key, keys), known).filter((e) => !exactCommands.has(e.command));
          return [...exact, ...more];
        })()
      : words.length
        ? this.collect((s) => {
            const text = `${s.title} ${s.command} ${s.key} ${formatKey(s.key)}`.toLowerCase();
            return words.every((w) => text.includes(w));
          }, known)
        : undefined;
    const payload = JSON.stringify({
      type: 'data',
      platform: process.platform,
      scanCodes: scanCodeLabels(),
      layout: activeLayout().name,
      tip,
      useful,
      learned,
      focus: focusAreas.map((a) => a.name),
      areaShortcuts,
      results: results?.slice(0, MAX_RESULTS),
      resultCount: results?.length,
    });
    // Cursor movements trigger frequent updates – only redraw on real changes.
    if (payload !== this.lastPayload) {
      this.lastPayload = payload;
      this.view.webview.postMessage(JSON.parse(payload));
    }
  }

  /**
   * Entries for all commands with at least one matching binding, regardless of
   * the current situation, sorted by title.
   */
  private collect(test: (s: Shortcut) => boolean, known: Set<string>): Entry[] {
    const boosted = reason('boosted');
    const entries = new Map<string, Entry>();
    for (const s of this.shortcuts) {
      if (!s.key || !test(s)) {
        continue;
      }
      const e = entries.get(s.command) ?? {
        command: s.command,
        title: s.title,
        keys: [],
        whens: [],
        known: known.has(s.command),
        boosted: boosted.enabled && s.command in (boosted.commands ?? {}),
      };
      if (!e.keys.includes(s.key)) {
        e.keys.push(s.key);
      }
      if (!e.whens.includes(s.when ?? '')) {
        e.whens.push(s.when ?? '');
      }
      entries.set(s.command, e);
    }
    return [...entries.values()].sort((x, y) => x.title.localeCompare(y.title));
  }

  /** For frequent events such as cursor movements. */
  scheduleUpdate(): void {
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => this.update(), 250);
  }

  private html(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const nonce = [...Array(32)].map(() => Math.random().toString(36)[2]).join('');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'main.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'main.css'));
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${style}" rel="stylesheet">
</head>
<body>
  <button id="focus" class="focus" title="Choose the areas you want to learn"></button>
  <div class="search">
    <input id="search" type="search" placeholder="Search shortcuts by name, command or key …" spellcheck="false">
    <button id="record" class="record" title="Filter by shortcut: press the keys to find what they do (Esc clears, a second Esc stops)">⌨</button>
  </div>
  <ul id="results" class="list" hidden></ul>
  <div id="main">
    <div id="tip" class="tip" hidden></div>
    <ul id="useful" class="list"><li class="empty">Loading shortcuts …</li></ul>
    <div id="areas"></div>
    <details id="learned-box" class="section">
      <summary>Learned (<span id="learned-count">0</span>)</summary>
      <ul id="learned" class="list"></ul>
    </details>
  </div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

interface RecordedChord {
  mods: string[];
  mains: string[];
}

/**
 * Whether a binding matches the recorded chords: "exact", or "more" if it needs
 * additional modifiers (Ctrl+K also finds Ctrl+Shift+K) or further chords
 * (Ctrl+K also finds Ctrl+K Ctrl+S).
 */
function matchesKeys(key: string, recorded: RecordedChord[]): 'exact' | 'more' | undefined {
  const chords = key.split(' ');
  let exact = chords.length === recorded.length;
  for (const [i, r] of recorded.entries()) {
    if (!chords[i]) {
      return undefined;
    }
    const parts = chords[i].split(/\+(?!$)/);
    const main = parts.pop()!;
    if ((r.mains.length && !r.mains.includes(main)) || !r.mods.every((m) => parts.includes(m))) {
      return undefined;
    }
    exact &&= parts.length === r.mods.length;
  }
  return exact ? 'exact' : 'more';
}

/** Lets the user pick the areas to learn; they are stored with the "focus" reason. */
async function chooseFocus(): Promise<void> {
  const focus = reason('focus');
  const picked = await vscode.window.showQuickPick(
    AREAS_FOR_SELECTION.map((a) => ({ label: a.name, id: a.id, picked: !!focus.areas?.includes(a.id) })),
    { canPickMany: true, title: 'Learning Focus', placeHolder: 'Which areas do you want to learn? Their shortcuts get a bonus.' },
  );
  if (!picked) {
    return;
  }
  await saveReason('focus', {
    enabled: picked.length ? true : focus.enabled,
    label: focus.label,
    bonus: focus.bonus,
    areas: picked.map((p) => p.id),
  });
}

/** Adds a command to the "boosted" reason with its default bonus, or removes it. */
async function setBoosted(command: string, on: boolean): Promise<void> {
  const boosted = reason('boosted');
  const commands = { ...boosted.commands };
  if (on) {
    commands[command] = boosted.params.boost.value;
  } else {
    delete commands[command];
  }
  // Boosting a shortcut while the reason is turned off would have no effect.
  await saveReason('boosted', { enabled: on || boosted.enabled, label: boosted.label, commands });
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ShortcutViewProvider(context);
  provider.refresh();

  // Pick up changes to the user's keybindings.json immediately.
  const userFile = userKeybindingsUri(context);
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.joinPath(userFile, '..'), 'keybindings.json'),
  );
  const refresh = () => provider.refresh();
  const changed = () => provider.scheduleUpdate();

  context.subscriptions.push(
    provider.nudges,
    vscode.window.registerWebviewViewProvider(ShortcutViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('shortcutTutor.show', () =>
      vscode.commands.executeCommand(`${ShortcutViewProvider.viewId}.focus`),
    ),
    vscode.commands.registerCommand('shortcutTutor.toggle', () =>
      provider.isVisible()
        ? vscode.commands.executeCommand('workbench.action.closeSidebar')
        : vscode.commands.executeCommand(`${ShortcutViewProvider.viewId}.focus`),
    ),
    vscode.commands.registerCommand('shortcutTutor.chooseFocus', chooseFocus),
    vscode.commands.registerCommand('shortcutTutor.editReasons', () =>
      ReasonsEditor.show(context.extensionUri, () => provider.commandInfo()),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('shortcutTutor.keyboardLayout')) {
        provider.scheduleUpdate();
      }
      if (e.affectsConfiguration('shortcutTutor.reasons')) {
        invalidateReasons();
        ReasonsEditor.onSettingChanged();
        provider.scheduleUpdate();
      }
    }),
    watcher,
    watcher.onDidChange(refresh),
    watcher.onDidCreate(refresh),
    watcher.onDidDelete(refresh),
    vscode.extensions.onDidChange(refresh),
    vscode.window.onDidChangeActiveTextEditor(changed),
    vscode.window.onDidChangeActiveNotebookEditor(changed),
    vscode.window.onDidChangeTextEditorSelection(changed),
    vscode.window.tabGroups.onDidChangeTabs(changed),
    vscode.window.tabGroups.onDidChangeTabGroups(changed),
    vscode.window.onDidOpenTerminal(changed),
    vscode.window.onDidCloseTerminal(changed),
    vscode.debug.onDidStartDebugSession(changed),
    vscode.debug.onDidTerminateDebugSession(changed),
    vscode.languages.onDidChangeDiagnostics(changed),
  );
}

export function deactivate(): void {}
