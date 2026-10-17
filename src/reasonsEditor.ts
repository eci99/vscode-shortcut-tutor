import * as vscode from 'vscode';
import { defaultReasons, getReasons, ReasonOverride, resetReason, saveReason } from './reasons';
import { AREAS_FOR_SELECTION } from './areas';

/** Title and key per command, used to preview commands in the editor. */
export type CommandInfo = Record<string, { title: string; key?: string }>;

/** Editor tab to view and edit all reasons. */
export class ReasonsEditor {
  private static current?: ReasonsEditor;
  /** Number of setting writes made by this editor that have not been echoed back yet. */
  private ownWrites = 0;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly commandInfo: () => CommandInfo,
  ) {
    const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [mediaUri] };
    panel.webview.html = this.html(panel.webview, mediaUri);
    panel.onDidDispose(() => (ReasonsEditor.current = undefined));

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
        case 'ready':
          this.send();
          break;
        case 'save':
          this.ownWrites++;
          if (!(await saveReason(msg.id, msg.value as ReasonOverride))) {
            this.ownWrites--;
          }
          break;
        case 'reset':
          // Without a stored override nothing changes in the setting; redraw anyway to drop unsaved input.
          if (!(await resetReason(msg.id))) {
            this.send();
          }
          break;
        case 'resetAll': {
          const choice = await vscode.window.showWarningMessage(
            'Reset all reasons to their defaults?',
            { modal: true },
            'Reset All',
          );
          if (choice) {
            await resetReason();
          }
          break;
        }
      }
    });
  }

  static show(extensionUri: vscode.Uri, commandInfo: () => CommandInfo): void {
    if (ReasonsEditor.current) {
      ReasonsEditor.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('shortcutTutor.reasons', 'Shortcut Tutor: Reasons', vscode.ViewColumn.Active, {
      retainContextWhenHidden: true,
    });
    ReasonsEditor.current = new ReasonsEditor(panel, extensionUri, commandInfo);
  }

  /** Called when the setting changes; redraws unless the change came from typing in this editor. */
  static onSettingChanged(): void {
    const editor = ReasonsEditor.current;
    if (!editor) {
      return;
    }
    if (editor.ownWrites > 0) {
      editor.ownWrites--;
      return;
    }
    editor.send();
  }

  private send(): void {
    this.panel.webview.postMessage({
      type: 'init',
      reasons: [...getReasons().values()],
      defaults: defaultReasons(),
      commands: this.commandInfo(),
      areas: AREAS_FOR_SELECTION.map((a) => ({ id: a.id, name: a.name })),
    });
  }

  private html(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const nonce = [...Array(32)].map(() => Math.random().toString(36)[2]).join('');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'reasons.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'reasons.css'));
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
  <header>
    <h1>Reasons</h1>
    <p class="hint">Changes are saved automatically to the <code>shortcutTutor.reasons</code> setting (only differences from the defaults).</p>
    <button id="reset-all" class="secondary">Reset All</button>
  </header>
  <div class="layout">
    <nav id="nav" aria-label="Reasons"></nav>
    <main id="content">Loading …</main>
  </div>
  <datalist id="all-commands"></datalist>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
