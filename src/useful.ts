import * as vscode from 'vscode';
import { Context, isRelevant, matchingKeys } from './context';
import { Shortcut } from './keybindings';
import { fillLabel, getReasons, Reason } from './reasons';
import { areaOf } from './areas';

export interface UsefulItem {
  command: string;
  score: number;
  reasons: string[];
}

/** Bonus from other sources (e.g. detected inefficient workflows). */
export interface Boost {
  bonus: number;
  reason: string;
}

/** Situations that are not expressed in when clauses but suggest certain commands. */
function situationBoosts(reasons: Map<string, Reason>): Map<string, Boost[]> {
  const boosts = new Map<string, Boost[]>();
  const signal = (id: string) => {
    const r = reasons.get(id);
    return r?.enabled ? r : undefined;
  };
  const add = (r: Reason | undefined, vars?: { count?: number }) => {
    for (const [command, bonus] of Object.entries(r?.commands ?? {})) {
      boosts.set(command, [...(boosts.get(command) ?? []), { bonus, reason: fillLabel(r!.label, vars) }]);
    }
  };

  add(signal('boosted'));
  const editor = vscode.window.activeTextEditor;
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (tab?.isDirty) {
    add(signal('unsaved'));
  }
  if (editor) {
    const problems = vscode.languages
      .getDiagnostics(editor.document.uri)
      .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning);
    if (problems.length) {
      add(signal('problems'), { count: problems.length });
    }
    if (!editor.selection.isEmpty) {
      add(signal('selection'));
    }
    const longFile = signal('longFile');
    if (longFile && editor.document.lineCount > longFile.params.lines.value) {
      add(longFile);
    }
  }
  const manyEditors = signal('manyEditors');
  const openTabs = vscode.window.tabGroups.all.reduce((n, g) => n + g.tabs.length, 0);
  if (manyEditors && openTabs > manyEditors.params.tabs.value) {
    add(manyEditors);
  }
  if (vscode.window.terminals.length) {
    add(signal('terminal'));
  }
  return boosts;
}

export function rankUseful(
  shortcuts: Shortcut[],
  ctx: Context,
  known: Set<string>,
  nudges: Map<string, Boost>,
): UsefulItem[] {
  const reasons = getReasons();
  const general = reasons.get('general')!.params;
  const essentials = reasons.get('essentials')!;
  const weights = essentials.enabled ? essentials.commands ?? {} : {};
  const focus = reasons.get('focus')!;
  const focusAreas = new Set(focus.enabled ? focus.areas : []);

  /** Context key → reason that rewards it. */
  const byContextKey = new Map<string, Reason>();
  for (const r of reasons.values()) {
    if (r.kind === 'context' && r.enabled) {
      r.contextKeys?.forEach((k) => byContextKey.set(k, r));
    }
  }

  const boosts = situationBoosts(reasons);
  const items = new Map<string, { base: number; situational: number; reasons: Set<string> }>();

  for (const s of shortcuts) {
    if (!s.key || known.has(s.command) || !isRelevant(s.when, ctx)) {
      continue;
    }
    let item = items.get(s.command);
    if (!item) {
      item = { base: weights[s.command] ?? 0, situational: 0, reasons: new Set() };
      items.set(s.command, item);
    }
    // Per command, the best-matching binding counts; each reason only once.
    let bonus = 0;
    const labels: string[] = [];
    const counted = new Set<string>();
    for (const key of matchingKeys(s.when, ctx)) {
      const r = byContextKey.get(key);
      if (r && !counted.has(r.id)) {
        counted.add(r.id);
        bonus += r.bonus ?? 0;
        labels.push(fillLabel(r.label, { value: ctx.get(key) }));
      }
    }
    if (bonus > item.situational) {
      item.situational = bonus;
      labels.forEach((l) => item!.reasons.add(l));
    }
  }

  const result: UsefulItem[] = [];
  for (const [command, item] of items) {
    const labels = [...item.reasons];
    let score = item.base + item.situational;
    for (const b of boosts.get(command) ?? []) {
      score += b.bonus;
      labels.push(b.reason);
    }
    const area = focusAreas.size ? areaOf(command) : undefined;
    if (area && focusAreas.has(area.id)) {
      score += focus.bonus ?? 0;
      labels.push(fillLabel(focus.label, { value: area.name }));
    }
    const nudge = nudges.get(command);
    if (nudge) {
      score += nudge.bonus;
      labels.unshift(nudge.reason);
    }
    if (item.base >= essentials.params.threshold.value && !labels.length && essentials.label) {
      labels.push(essentials.label);
    }
    if (score >= general.minScore.value) {
      result.push({ command, score, reasons: [...new Set(labels)] });
    }
  }
  return result.sort((a, b) => b.score - a.score).slice(0, general.maxEntries.value);
}
