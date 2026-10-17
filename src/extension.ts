import * as vscode from 'vscode';
import { formatKey, loadShortcuts, Shortcut, userKeybindingsUri } from './keybindings';
import { activeLayout, scanCodeLabels } from './layouts';
import { buildContext, Context, isRelevant } from './context';
import { rankUseful } from './useful';
import { NudgeTracker } from './nudges';
import { invalidateReasons, reason, saveReason } from './reasons';
import { AREAS_FOR_SELECTION } from './areas';
import { CommandInfo, ReasonsEditor } from './reasonsEditor';

const KNOWN_KEY = 'shortcutTutor.known';

/** An entry as displayed by the webview. */
interface Entry {
  command: string;
  title: string;
  keys: string[];
  reasons?: string[];
}

class ShortcutViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'shortcutTutor.view';
  private view?: vscode.WebviewView;
  private shortcuts: Shortcut[] = [];
  private updateTimer?: NodeJS.Timeout;
  private lastPayload = '';
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
    const focusNames = focus.enabled
      ? AREAS_FOR_SELECTION.filter((a) => focus.areas?.includes(a.id)).map((a) => a.name)
      : [];
    const payload = JSON.stringify({
      type: 'data',
      platform: process.platform,
      scanCodes: scanCodeLabels(),
      layout: activeLayout().name,
      tip,
      useful,
      learned,
      focus: focusNames,
    });
    // Cursor movements trigger frequent updates – only redraw on real changes.
    if (payload !== this.lastPayload) {
      this.lastPayload = payload;
      this.view.webview.postMessage(JSON.parse(payload));
    }
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
  <div id="tip" class="tip" hidden></div>
  <ul id="useful" class="list"><li class="empty">Loading shortcuts …</li></ul>
  <details id="learned-box" class="learned">
    <summary>Learned (<span id="learned-count">0</span>)</summary>
    <ul id="learned" class="list"></ul>
  </details>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
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
