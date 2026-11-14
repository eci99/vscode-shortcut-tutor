/**
 * Practice tasks. Text tasks are written with markers: "|" is a cursor,
 * "«…»" a selection (its direction does not matter). A task is solved when
 * the editor reaches one of its goal states.
 */

export type WorkbenchEvent = 'terminal' | 'split' | 'quickOpen' | 'newFile' | 'fold';

export interface Exercise {
  command: string;
  task: string;
  start?: string;
  /** Accepted end states; a goal without markers compares only the text (ignoring trailing spaces). */
  goal?: string[];
  event?: WorkbenchEvent;
  /** Edits and keyboard cursor moves that still count as "done with the shortcut" (default 4). */
  maxEvents?: number;
}

export interface State {
  text: string;
  /** [start, end] offsets, sorted. */
  ranges: [number, number][];
}

export function parseState(s: string): State {
  let text = '';
  const ranges: [number, number][] = [];
  let open: number | undefined;
  for (const ch of s) {
    if (ch === '|') {
      ranges.push([text.length, text.length]);
    } else if (ch === '«') {
      open = text.length;
    } else if (ch === '»' && open !== undefined) {
      ranges.push([open, text.length]);
      open = undefined;
    } else {
      text += ch;
    }
  }
  return { text, ranges: ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]) };
}

const trimLines = (t: string) => t.split('\n').map((l) => l.trimEnd()).join('\n');

export function matches(state: State, goals: string[]): boolean {
  const ranges = state.ranges.map(([a, b]) => [Math.min(a, b), Math.max(a, b)]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return goals.some((g) => {
    const goal = parseState(g);
    if (!goal.ranges.length) {
      return trimLines(state.text) === trimLines(goal.text);
    }
    return (
      state.text === goal.text &&
      ranges.length === goal.ranges.length &&
      goal.ranges.every(([a, b], i) => ranges[i][0] === a && ranges[i][1] === b)
    );
  });
}

const steps = Array.from({ length: 14 }, (_, i) => `step(${i + 1});`);

export const EXERCISES: Exercise[] = [
  {
    command: 'editor.action.copyLinesDownAction',
    task: 'Duplicate the line "let total = 0;".',
    start: 'let x = 1;\n|let total = 0;\nlet y = 2;',
    goal: ['let x = 1;\nlet total = 0;\nlet total = 0;\nlet y = 2;'],
  },
  {
    command: 'editor.action.moveLinesUpAction',
    task: 'Move the line "const msg = …" up one line.',
    start: 'function greet() {\n  return msg;\n  |const msg = "hi";\n}',
    goal: ['function greet() {\n  const msg = "hi";\n  return msg;\n}'],
  },
  {
    command: 'editor.action.deleteLines',
    task: 'Delete the console.log line.',
    start: 'const keep = 1;\nconsole.log("debug", |keep);\nconst also = 2;',
    goal: ['const keep = 1;\nconst also = 2;'],
  },
  {
    command: 'editor.action.commentLine',
    task: 'Comment out the line "const b = 2;".',
    start: 'const a = 1;\nconst b = |2;\nconst c = 3;',
    goal: ['const a = 1;\n// const b = 2;\nconst c = 3;'],
  },
  {
    command: 'editor.action.insertLineAfter',
    task: 'Insert an empty line below the run(…) line without breaking it.',
    start: 'if (ok) {\n  run(|"now", "and", "later");\n}',
    goal: ['if (ok) {\n  run("now", "and", "later");\n\n}'],
  },
  {
    command: 'cursorWordEndRight',
    task: 'Move the cursor word by word to just after "result".',
    start: '|const result = compute(alpha, beta);',
    goal: ['const result| = compute(alpha, beta);'],
  },
  {
    command: 'cursorHome',
    task: 'Jump to the start of the line (before "return").',
    start: '    return compute(alpha, beta, gamma);|',
    goal: ['    |return compute(alpha, beta, gamma);'],
  },
  {
    command: 'workbench.action.gotoLine',
    task: 'Go to the line marked TARGET (use the line number in the gutter).',
    start: '|' + steps.map((s, i) => (i === 10 ? `${s} // TARGET` : s)).join('\n'),
    goal: [steps.map((s, i) => (i === 10 ? `|${s} // TARGET` : s)).join('\n')],
  },
  {
    command: 'editor.action.jumpToBracket',
    task: 'Jump from "{" to its matching "}".',
    start: 'call(|{ a: 1, b: [2, 3], c: "x" }, extra, more, args, here);',
    goal: [
      'call({ a: 1, b: [2, 3], c: "x" |}, extra, more, args, here);',
      'call({ a: 1, b: [2, 3], c: "x" }|, extra, more, args, here);',
    ],
  },
  {
    command: 'editor.action.addSelectionToNextFindMatch',
    task: 'Select the word under the cursor and its next two occurrences.',
    start: 'const |item = list[0];\nlog(item);\nsave(item);\nreturn item;',
    goal: ['const «item» = list[0];\nlog(«item»);\nsave(«item»);\nreturn item;'],
  },
  {
    command: 'editor.action.selectHighlights',
    task: 'Select all occurrences of the word under the cursor at once.',
    start: 'const |name = user.title;\ncheck(name);\nlog(name);\nsave(name);\nsend(name);\nreturn name;',
    goal: ['const «name» = user.title;\ncheck(«name»);\nlog(«name»);\nsave(«name»);\nsend(«name»);\nreturn «name»;'],
  },
  {
    command: 'editor.action.insertCursorBelow',
    task: 'Put a cursor at the start of each of the four lines.',
    start: '|red\ngreen\nblue\ngray',
    goal: ['|red\n|green\n|blue\n|gray'],
  },
  {
    command: 'editor.action.smartSelect.expand',
    task: 'Expand the selection to everything inside the parentheses.',
    start: 'call(alpha, be|ta, gamma, delta);',
    goal: ['call(«alpha, beta, gamma, delta»);', 'call«(alpha, beta, gamma, delta)»;'],
  },
  {
    command: 'editor.action.moveLinesDownAction',
    task: 'Move the line "const msg = …" down one line.',
    start: 'function greet() {\n  |const msg = "hi";\n  log("start");\n  return msg;\n}',
    goal: ['function greet() {\n  log("start");\n  const msg = "hi";\n  return msg;\n}'],
  },
  {
    command: 'editor.action.copyLinesDownAction',
    task: 'Duplicate the two selected lines.',
    start: '«first();\nsecond();»\nthird();',
    goal: ['first();\nsecond();\nfirst();\nsecond();\nthird();'],
  },
  {
    command: 'editor.action.deleteLines',
    task: 'Delete the two selected lines.',
    start: 'keep();\n«remove();\nremove();»\nkeep();',
    goal: ['keep();\nkeep();'],
  },
  {
    command: 'editor.action.commentLine',
    task: 'Uncomment the line with b.',
    start: 'const a = 1;\n// const b = |2;\nconst c = 3;',
    goal: ['const a = 1;\nconst b = 2;\nconst c = 3;'],
  },
  {
    command: 'editor.action.commentLine',
    task: 'Comment out the three selected lines at once.',
    start: '«const a = 1;\nconst b = 2;\nconst c = 3;»\nconst d = 4;',
    goal: ['// const a = 1;\n// const b = 2;\n// const c = 3;\nconst d = 4;'],
  },
  {
    command: 'editor.action.blockComment',
    task: 'Wrap the selection in a block comment.',
    start: 'const x = «compute(1, 2)»;',
    goal: ['const x = /* compute(1, 2) */;', 'const x = /*compute(1, 2)*/;'],
  },
  {
    command: 'editor.action.insertLineBefore',
    task: 'Insert an empty line above the run(…) line without breaking it.',
    start: 'if (ok) {\n  run("now", |"and", "later");\n}',
    goal: ['if (ok) {\n\n  run("now", "and", "later");\n}'],
  },
  {
    command: 'editor.action.indentLines',
    task: 'Indent the return line by one level (cursor stays where it is).',
    start: 'function f() {\nreturn |value;\n}',
    goal: ['function f() {\n    return value;\n}', 'function f() {\n\treturn value;\n}', 'function f() {\n  return value;\n}'],
  },
  {
    command: 'editor.action.outdentLines',
    task: 'Outdent the return line by one level (cursor stays where it is).',
    start: 'function f() {\n        return |value;\n}',
    goal: ['function f() {\n    return value;\n}', 'function f() {\n      return value;\n}', 'function f() {\nreturn value;\n}'],
  },
  {
    command: 'deleteWordLeft',
    task: 'Delete the long word before the cursor at once.',
    start: 'const result = veryLongVariableName|;',
    goal: ['const result = ;', 'const result =;'],
  },
  {
    command: 'deleteWordRight',
    task: 'Delete the long word after the cursor at once.',
    start: 'const x = |anotherLongName + 1;',
    goal: ['const x =  + 1;', 'const x = + 1;', 'const x = 1;'],
  },
  {
    command: 'cursorWordStartLeft',
    task: 'Move the cursor word by word to just before "delta".',
    start: 'alpha beta gamma delta epsilon|',
    goal: ['alpha beta gamma |delta epsilon'],
  },
  {
    command: 'cursorEnd',
    task: 'Jump to the end of the line.',
    start: '|    return compute(alpha, beta, gamma);',
    goal: ['    return compute(alpha, beta, gamma);|'],
  },
  {
    command: 'cursorBottom',
    task: 'Jump to the very end of the document.',
    start: '|' + steps.slice(0, 10).join('\n'),
    goal: [steps.slice(0, 10).join('\n') + '|'],
  },
  {
    command: 'cursorWordEndRightSelect',
    task: 'Select the first two words, word by word.',
    start: '|alpha beta gamma delta',
    goal: ['«alpha beta» gamma delta'],
  },
  {
    command: 'cursorWordStartLeftSelect',
    task: 'Select the last two words, word by word.',
    start: 'alpha beta gamma delta|',
    goal: ['alpha beta «gamma delta»'],
  },
  {
    command: 'cursorEndSelect',
    task: 'Select from the cursor to the end of the line.',
    start: 'const x = |compute(alpha, beta, gamma);',
    goal: ['const x = «compute(alpha, beta, gamma);»'],
  },
  {
    command: 'cursorHomeSelect',
    task: 'Select from the cursor back to the start of the code on this line.',
    start: '    return |value + other + more;',
    goal: ['    «return »value + other + more;'],
  },
  {
    command: 'cursorBottomSelect',
    task: 'Select from the cursor to the end of the document.',
    start: 'line one\nline |two\nline three\nline four',
    goal: ['line one\nline «two\nline three\nline four»'],
  },
  {
    command: 'expandLineSelection',
    task: 'Select the whole current line.',
    start: 'first line\nmiddle |line here\nlast line',
    goal: ['first line\n«middle line here\n»last line'],
  },
  {
    command: 'editor.action.insertCursorAbove',
    task: 'Put a cursor at the start of each of the four lines.',
    start: 'red\ngreen\nblue\n|gray',
    goal: ['|red\n|green\n|blue\n|gray'],
  },
  {
    command: 'editor.action.insertCursorAtEndOfEachLineSelected',
    task: 'Put a cursor at the end of each selected line.',
    start: '«red\ngreen\nblue\ngray»',
    goal: ['red|\ngreen|\nblue|\ngray|'],
  },
  {
    command: 'editor.action.moveSelectionToNextFindMatch',
    task: 'Skip the selected occurrence: move the selection to the next one.',
    start: 'const «item» = list[0];\nlog(item);\nsave(item);',
    goal: ['const item = list[0];\nlog(«item»);\nsave(item);'],
  },
  {
    command: 'editor.action.addSelectionToNextFindMatch',
    task: 'Rename the variable to "sum" in all three places with multiple cursors.',
    start: 'let |tmp = 0;\ntmp += 1;\nreturn tmp;',
    goal: ['let sum = 0;\nsum += 1;\nreturn sum;'],
    maxEvents: 8,
  },
  {
    command: 'editor.action.startFindReplaceAction',
    task: 'Replace every "count" with "total" (Replace All).',
    start: 'let |count = 0;\ncount = count + 1;\nlog(count);\nreturn count;',
    goal: ['let total = 0;\ntotal = total + 1;\nlog(total);\nreturn total;'],
  },
  {
    command: 'editor.fold',
    task: 'Fold the function body the cursor is in.',
    start: 'function outer() {\n  const a = |1;\n  const b = 2;\n  return a + b;\n}\nconst after = 3;\nconst more = 4;',
    event: 'fold',
  },
  { command: 'workbench.action.splitEditorOrthogonal', task: 'Split the editor in the other direction (below).', event: 'split' },
  { command: 'workbench.action.terminal.new', task: 'Create a new terminal.', event: 'terminal' },
  { command: 'workbench.action.splitEditor', task: 'Split the editor.', event: 'split' },
  { command: 'workbench.action.quickOpen', task: 'Open any file of the workspace by name.', event: 'quickOpen' },
  { command: 'workbench.action.files.newUntitledFile', task: 'Open a new untitled file.', event: 'newFile' },
];
