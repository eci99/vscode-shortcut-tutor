import { test } from 'node:test';
import * as assert from 'node:assert';
import { EXERCISES, matches, parseState } from './exercises';

test('every text exercise starts unsolved and its goals are reachable', () => {
  for (const e of EXERCISES.filter((x) => x.goal)) {
    const start = parseState(e.start!);
    assert.ok(start.ranges.length, `${e.command}: start needs a cursor`);
    assert.ok(!matches(start, e.goal!), `${e.command}: already solved at start`);
    for (const g of e.goal!) {
      const goal = parseState(g);
      // A text-only goal is reached with any cursor.
      assert.ok(matches({ text: goal.text, ranges: goal.ranges.length ? goal.ranges : [[0, 0]] }, e.goal!), `${e.command}: goal not reachable`);
    }
  }
});

test('selected words do not appear in the task text', () => {
  // Find-match commands would also select them in the header above the body.
  for (const e of EXERCISES.filter((x) => x.goal)) {
    for (const g of e.goal!) {
      const { text, ranges } = parseState(g);
      for (const [a, b] of ranges.filter(([a, b]) => a !== b)) {
        assert.ok(!new RegExp(`\\b${text.slice(a, b)}\\b`).test(e.task), `${e.command}: "${text.slice(a, b)}" in task`);
      }
    }
  }
});

test('workbench exercises have an event', () => {
  for (const e of EXERCISES.filter((x) => !x.goal)) {
    assert.ok(e.event, e.command);
  }
});

test('parseState and matches', () => {
  assert.deepStrictEqual(parseState('a|b«cd»'), { text: 'abcd', ranges: [[1, 1], [2, 4]] });
  // Selection direction and order do not matter.
  assert.ok(matches({ text: 'abcd', ranges: [[4, 2], [1, 1]] }, ['a|b«cd»']));
  assert.ok(!matches({ text: 'abcd', ranges: [[1, 1]] }, ['a|b«cd»']));
  // Text-only goals ignore trailing spaces.
  assert.ok(matches({ text: 'x  \ny', ranges: [] }, ['x\ny']));
});
