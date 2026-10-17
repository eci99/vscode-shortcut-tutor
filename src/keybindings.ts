import * as vscode from 'vscode';
import * as path from 'path';
import { parse } from 'jsonc-parser';
import { scanCodeLabels } from './layouts';

export type Source = 'default' | 'user' | 'extension';

export interface Shortcut {
  /** Normalized key sequence, e.g. "ctrl+k ctrl+s". */
  key: string;
  command: string;
  when?: string;
  title: string;
  category?: string;
  source: Source;
  extension?: string;
}

interface RawBinding {
  key?: string;
  mac?: string;
  linux?: string;
  win?: string;
  command?: string;
  when?: string;
}

interface CommandInfo {
  title?: string;
  category?: string;
  extension?: string;
  builtin: boolean;
}

const DEFAULT_KEYBINDINGS_URI = vscode.Uri.parse('vscode://defaultsettings/keybindings.json');
const MODIFIER_ORDER = ['ctrl', 'shift', 'alt', 'meta'];

/** Puts modifiers in a fixed order so that "shift+ctrl+p" and "ctrl+shift+p" are equal. */
export function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((chord) => {
      const parts = chord.split(/\+(?!$)/);
      const mods = new Set<string>();
      let main = '';
      for (const p of parts) {
        const m = p === 'cmd' || p === 'win' ? 'meta' : p;
        if (MODIFIER_ORDER.includes(m)) {
          mods.add(m);
        } else {
          main = p;
        }
      }
      return [...MODIFIER_ORDER.filter((m) => mods.has(m)), main].filter(Boolean).join('+');
    })
    .join(' ');
}

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc', enter: 'Enter', space: 'Space', tab: 'Tab', backspace: '⌫', delete: 'Del',
  left: '←', right: '→', up: '↑', down: '↓', pageup: 'PgUp', pagedown: 'PgDn',
  home: 'Home', end: 'End', insert: 'Ins',
};

/**
 * Some default bindings name a physical key as scan code, e.g. "[equal]".
 * Returns its label on the chosen keyboard layout, or undefined for normal keys.
 */
export function scanCodeLabel(k: string, labels: Record<string, string> = scanCodeLabels()): string | undefined {
  const m = /^\[(.+)\]$/.exec(k);
  if (!m) {
    return undefined;
  }
  return labels[m[1]] ?? m[1].charAt(0).toUpperCase() + m[1].slice(1);
}

/** "ctrl+shift+p" -> "Ctrl+Shift+P" (same labels as in the webview). */
export function formatKey(key: string): string {
  const mods: Record<string, string> =
    process.platform === 'darwin'
      ? { ctrl: '⌃', shift: '⇧', alt: '⌥', meta: '⌘' }
      : { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: process.platform === 'win32' ? 'Win' : 'Meta' };
  const scanLabels = scanCodeLabels();
  const label = (k: string) =>
    scanCodeLabel(k, scanLabels) ??
    mods[k] ??
    KEY_LABELS[k] ??
    (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1));
  return key
    .split(' ')
    .map((chord) => chord.split(/\+(?!$)/).map(label).join('+'))
    .join(', then ');
}

function platformKey(b: RawBinding): string | undefined {
  switch (process.platform) {
    case 'darwin':
      return b.mac ?? b.key;
    case 'win32':
      return b.win ?? b.key;
    default:
      return b.linux ?? b.key;
  }
}

function localizedString(value: unknown): string | undefined {
  if (typeof value === 'object' && value && 'value' in value) {
    value = (value as { value: unknown }).value;
  }
  // Unresolved NLS placeholders like "%git.commit%" are useless to humans.
  return typeof value === 'string' && !value.startsWith('%') ? value : undefined;
}

/** "workbench.action.files.saveAll" -> "Save All" */
function humanize(command: string): string {
  const last = command.split('.').pop() ?? command;
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function collectExtensionInfo(): { commands: Map<string, CommandInfo>; bindings: Shortcut[] } {
  const commands = new Map<string, CommandInfo>();
  const bindings: Shortcut[] = [];
  const appRoot = path.normalize(vscode.env.appRoot);

  for (const ext of vscode.extensions.all) {
    const pkg = ext.packageJSON ?? {};
    const contributes = pkg.contributes ?? {};
    const builtin = path.normalize(ext.extensionPath).startsWith(appRoot);
    const extName = localizedString(pkg.displayName) ?? pkg.name ?? ext.id;

    const cmds = Array.isArray(contributes.commands) ? contributes.commands : [];
    for (const c of cmds) {
      if (typeof c?.command !== 'string') {
        continue;
      }
      commands.set(c.command, {
        title: localizedString(c.title),
        category: localizedString(c.category),
        extension: extName,
        builtin,
      });
    }

    const kbs = Array.isArray(contributes.keybindings) ? contributes.keybindings : [];
    for (const kb of kbs as RawBinding[]) {
      const key = platformKey(kb);
      if (!key || typeof kb.command !== 'string') {
        continue;
      }
      bindings.push({
        key: normalizeKey(key),
        command: kb.command,
        when: kb.when,
        title: '',
        source: builtin ? 'default' : 'extension',
        extension: extName,
      });
    }
  }
  return { commands, bindings };
}

async function readDefaultKeybindings(): Promise<RawBinding[]> {
  try {
    const doc = await vscode.workspace.openTextDocument(DEFAULT_KEYBINDINGS_URI);
    const parsed = parse(doc.getText());
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[shortcut-tutor] Could not read default keybindings', err);
    return [];
  }
}

export function userKeybindingsUri(context: vscode.ExtensionContext): vscode.Uri {
  // globalStorageUri = <User>/globalStorage/<extension-id>
  return vscode.Uri.joinPath(context.globalStorageUri, '..', '..', 'keybindings.json');
}

async function readUserKeybindings(context: vscode.ExtensionContext): Promise<RawBinding[]> {
  try {
    const bytes = await vscode.workspace.fs.readFile(userKeybindingsUri(context));
    const parsed = parse(Buffer.from(bytes).toString('utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadShortcuts(context: vscode.ExtensionContext): Promise<Shortcut[]> {
  const [defaults, user] = await Promise.all([
    readDefaultKeybindings(),
    readUserKeybindings(context),
  ]);
  const { commands, bindings: extBindings } = collectExtensionInfo();

  const result: Shortcut[] = [];
  const seen = new Set<string>();
  const add = (s: Shortcut) => {
    const id = `${s.key}|${s.command}|${s.when ?? ''}`;
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const info = commands.get(s.command);
    s.title = info?.title ?? humanize(s.command);
    s.category = info?.category;
    s.extension ??= info?.extension;
    if (s.source === 'default' && info && !info.builtin) {
      s.source = 'extension';
    }
    result.push(s);
  };

  // The default file already contains the contributions of all extensions;
  // the package.json contributions only fill in anything that is missing.
  for (const b of defaults) {
    if (b.key && b.command) {
      add({ key: normalizeKey(b.key), command: b.command, when: b.when, title: '', source: 'default' });
    }
  }
  extBindings.forEach(add);

  // User keybindings: "-command" removes matching default bindings.
  for (const b of user) {
    if (!b.command) {
      continue;
    }
    if (b.command.startsWith('-')) {
      const cmd = b.command.slice(1);
      const key = b.key ? normalizeKey(b.key) : undefined;
      for (let i = result.length - 1; i >= 0; i--) {
        const r = result[i];
        if (
          r.source !== 'user' &&
          r.command === cmd &&
          (key === undefined || r.key === key) &&
          (b.when === undefined || r.when === b.when)
        ) {
          result.splice(i, 1);
        }
      }
    } else if (b.key) {
      add({ key: normalizeKey(b.key), command: b.command, when: b.when, title: '', source: 'user' });
    }
  }

  return result.sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
