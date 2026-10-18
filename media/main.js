// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const usefulEl = /** @type {HTMLElement} */ (document.getElementById('useful'));
  const learnedEl = /** @type {HTMLElement} */ (document.getElementById('learned'));
  const learnedCountEl = /** @type {HTMLElement} */ (document.getElementById('learned-count'));
  const learnedBox = /** @type {HTMLDetailsElement} */ (document.getElementById('learned-box'));
  const focusEl = /** @type {HTMLElement} */ (document.getElementById('focus'));
  const areasEl = /** @type {HTMLElement} */ (document.getElementById('areas'));
  const tipEl = /** @type {HTMLElement} */ (document.getElementById('tip'));
  const searchEl = /** @type {HTMLInputElement} */ (document.getElementById('search'));
  const recordEl = /** @type {HTMLElement} */ (document.getElementById('record'));
  const resultsEl = /** @type {HTMLElement} */ (document.getElementById('results'));
  const mainEl = /** @type {HTMLElement} */ (document.getElementById('main'));
  /** @type {number | undefined} */
  let tipTime;
  focusEl.addEventListener('click', () => vscode.postMessage({ type: 'chooseFocus' }));

  let platform = 'linux';
  /** @type {Record<string, string>} scan code ("equal") → character on the chosen layout ("´") */
  let scanCodes = {};
  let layout = '';

  const KEY_LABELS = {
    escape: 'Esc', enter: 'Enter', space: 'Space', tab: 'Tab', backspace: '⌫', delete: 'Del',
    left: '←', right: '→', up: '↑', down: '↓', pageup: 'PgUp', pagedown: 'PgDn',
    home: 'Home', end: 'End', insert: 'Ins',
  };

  function keyLabel(/** @type {string} */ k) {
    const mods = platform === 'darwin'
      ? { ctrl: '⌃', shift: '⇧', alt: '⌥', meta: '⌘' }
      : { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: platform === 'win32' ? 'Win' : 'Meta' };
    if (mods[k]) return mods[k];
    if (KEY_LABELS[k]) return KEY_LABELS[k];
    return k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1);
  }

  /** "ctrl+k ctrl+s" -> <kbd>Ctrl</kbd><kbd>K</kbd> then <kbd>Ctrl</kbd><kbd>S</kbd> */
  function renderKey(/** @type {string} */ key) {
    return key
      .split(' ')
      .map((chord) =>
        '<span class="chord">' +
        chord.split(/\+(?!$)/).map(renderPart).join('') +
        '</span>')
      .join('<span class="then">then</span>');
  }

  /**
   * Scan codes such as "[equal]" name a physical key. Extensions cannot read the
   * keyboard layout, so they are labeled for the layout chosen in the settings.
   */
  function renderPart(/** @type {string} */ part) {
    const m = /^\[(.+)\]$/.exec(part);
    if (!m) return `<kbd>${esc(keyLabel(part))}</kbd>`;
    const label = scanCodes[m[1]] ?? m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const title = `Physical key ${part} as labeled on a ${layout} keyboard (setting “Shortcut Tutor: Keyboard Layout”)`;
    return `<kbd title="${esc(title)}">${esc(label)}</kbd>`;
  }

  function esc(/** @type {string} */ s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
  }

  /** `boostable`: show the ★ button (in the learning focus sections and search results). */
  function renderEntry(e, /** @type {boolean} */ known, boostable = false) {
    return `
      <li class="row${known ? ' known' : ''}" data-cmd="${esc(e.command)}">
        <div class="entry">
          <div class="title-cell">
            <span class="title" title="${esc(titleTooltip(e))}">${esc(e.title)}</span>
            ${boostable && !known ? `<button class="icon-btn boost-btn${e.boosted ? ' on' : ''}" title="${e.boosted ? 'Remove boost' : 'Boost – rank higher in “Useful Now”'}">${e.boosted ? '★' : '☆'}</button>` : ''}
            <button class="icon-btn edit-btn" title="Change shortcut in the Keyboard Shortcuts editor">✎</button>
            <button class="icon-btn known-btn" title="${known ? 'Undo – show in “Useful Now” and tips again' : 'Got it – remove from “Useful Now” and tips'}">${known ? '↺' : '✓'}</button>
          </div>
          <div class="reasons">${(e.reasons || []).map((r) => `<span class="reason" title="${esc(r)}">${esc(r)}</span>`).join('')}</div>
          <div class="keys">${e.keys.map((k, i) => `<span class="key">${i ? '<span class="or">or</span>' : ''}${renderKey(k)}</span>`).join('')}</div>
        </div>
      </li>`;
  }

  /** Command id plus the when clauses of its bindings, one per line. */
  function titleTooltip(e) {
    const whens = (e.whens || []).map((w) => w || 'always');
    if (!whens.length) return e.command;
    return whens.length === 1
      ? `${e.command}\nwhen: ${whens[0]}`
      : `${e.command}\nwhen:\n${whens.map((w) => `• ${w}`).join('\n')}`;
  }

  const GAP = 8; // must match the column gap of .entry

  /**
   * Picks the layout per entry: first the reasons move to a second line,
   * and only if title and keys still don't fit, the keys follow.
   * Measures all entries in one batch to avoid repeated reflows.
   */
  function layoutEntries() {
    // Entries inside the collapsed "Learned" section have no size; they are laid out when it opens.
    const entries = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.entry')])
      .filter((el) => el.offsetParent);
    const available = entries.map((el) => el.clientWidth);
    entries.forEach((el) => el.classList.add('measure'));
    const widths = entries.map((el) => {
      const [title, reasons, keys] = /** @type {HTMLElement[]} */ ([...el.children]);
      return {
        title: title.getBoundingClientRect().width,
        reasons: reasons.childElementCount ? reasons.getBoundingClientRect().width : 0,
        keys: keys.getBoundingClientRect().width,
      };
    });
    entries.forEach((el, i) => {
      const w = widths[i];
      const full = w.title + w.keys + GAP + (w.reasons ? w.reasons + GAP : 0);
      el.classList.remove('measure', 'wrap-reasons', 'wrap-keys');
      if (full > available[i]) {
        el.classList.add(w.title + GAP + w.keys <= available[i] ? 'wrap-reasons' : 'wrap-keys');
      }
    });
  }

  let layoutFrame = 0;
  function scheduleLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(layoutEntries);
  }
  new ResizeObserver(scheduleLayout).observe(document.body);

  function onRowClick(/** @type {MouseEvent} */ e) {
    const target = /** @type {HTMLElement} */ (e.target);
    const row = target.closest('.row');
    const command = row?.getAttribute('data-cmd');
    if (!row || !command) return;
    const known = row.classList.contains('known');
    if (target.closest('.known-btn')) vscode.postMessage({ type: 'known', command, known: !known });
    else if (target.closest('.edit-btn')) vscode.postMessage({ type: 'edit', command });
    else if (target.closest('.boost-btn')) {
      vscode.postMessage({ type: 'boost', command, boosted: !target.closest('.boost-btn')?.classList.contains('on') });
    }
  }
  usefulEl.addEventListener('click', onRowClick);
  tipEl.addEventListener('click', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('.tip-close')) vscode.postMessage({ type: 'dismissTip' });
    else onRowClick(e);
  });
  areasEl.addEventListener('click', onRowClick);
  learnedEl.addEventListener('click', onRowClick);
  resultsEl.addEventListener('click', onRowClick);

  /** @type {{ learnedOpen?: boolean, openAreas?: string[], query?: string }} */
  const state = vscode.getState() || {};
  const openAreas = new Set(state.openAreas || []);
  function saveState() {
    vscode.setState({ learnedOpen: learnedBox.open, openAreas: [...openAreas], query: recording ? '' : searchEl.value });
  }

  // The extension host searches; typing is debounced so that not every key press sends a request.
  let searchTimer = 0;
  searchEl.value = state.query || '';
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      vscode.postMessage({ type: 'search', query: searchEl.value });
      saveState();
    }, 150);
  });
  searchEl.addEventListener('keydown', (e) => {
    if (recording && e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      // The first Esc clears the recorded keys, the second one ends recording.
      e.preventDefault();
      if (recorded.length) {
        recorded = [];
        recordedLabels = [];
        searchEl.value = '';
        vscode.postMessage({ type: 'search', query: '' });
      } else {
        toggleRecording();
      }
    } else if (recording) {
      recordKey(e);
    } else if (e.key === 'Escape' && searchEl.value) {
      searchEl.value = '';
      searchEl.dispatchEvent(new Event('input'));
    }
  });

  // --- Filter by shortcut ------------------------------------------------------
  // While recording, key presses in the search field are turned into a key
  // sequence (like "Record Keys" in the Keyboard Shortcuts editor).

  let recording = false;
  /** @type {{ mods: string[], mains: string[] }[]} per chord the modifiers and the accepted spellings of the main key */
  let recorded = [];
  /** @type {string[]} the chords as displayed */
  let recordedLabels = [];

  recordEl.addEventListener('click', toggleRecording);

  function toggleRecording() {
    recording = !recording;
    recorded = [];
    recordedLabels = [];
    recordEl.classList.toggle('on', recording);
    searchEl.value = '';
    searchEl.readOnly = recording;
    searchEl.placeholder = recording ? 'Press a shortcut …' : 'Search shortcuts by name, command or key …';
    vscode.postMessage({ type: 'search', query: '' });
    saveState();
    searchEl.focus();
  }

  const CODE_KEYS = {
    Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', IntlBackslash: 'oem_102',
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    NumpadAdd: 'numpad_add', NumpadSubtract: 'numpad_subtract', NumpadMultiply: 'numpad_multiply',
    NumpadDivide: 'numpad_divide', NumpadDecimal: 'numpad_decimal', NumpadEnter: 'enter',
  };
  const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

  /**
   * The main key in VS Code's notation. Letters and digits follow the keyboard layout,
   * as VS Code does; other keys use their position on a US keyboard.
   */
  function mainKey(/** @type {KeyboardEvent} */ e) {
    if (/^[a-z0-9]$/i.test(e.key)) return e.key.toLowerCase();
    if (CODE_KEYS[e.code]) return CODE_KEYS[e.code];
    let m = /^(?:Key|Digit)(.)$/.exec(e.code);
    if (m) return m[1].toLowerCase();
    m = /^Numpad(\d)$/.exec(e.code);
    if (m) return 'numpad' + m[1];
    return e.code.toLowerCase(); // F1, Escape, Enter, Space, Tab, Backspace, Delete, Home, End, PageUp, …
  }

  function heldModifiers(/** @type {KeyboardEvent} */ e) {
    return /** @type {string[]} */ ([e.ctrlKey && 'ctrl', e.shiftKey && 'shift', e.altKey && 'alt', e.metaKey && 'meta'].filter(Boolean));
  }

  /**
   * Filters live while only modifiers are held: the next chord is matched with any
   * main key, so holding Ctrl lists all Ctrl shortcuts and adding Shift narrows them.
   */
  function previewModifiers(/** @type {string[]} */ mods) {
    // After two chords the next key press starts a new sequence.
    const base = recorded.length === 2 ? [] : recorded;
    const labels = recorded.length === 2 ? [] : recordedLabels;
    if (!mods.length) {
      searchEl.value = recordedLabels.join(' ');
      vscode.postMessage({ type: 'search', keys: recorded });
      return;
    }
    searchEl.value = [...labels, mods.map(keyLabel).join('+') + '+…'].join(' ');
    vscode.postMessage({ type: 'search', keys: [...base, { mods, mains: [] }] });
  }

  function recordKey(/** @type {KeyboardEvent} */ e) {
    e.preventDefault();
    e.stopPropagation();
    const mods = heldModifiers(e);
    if (MODIFIER_CODES.test(e.code)) {
      if (!e.repeat) previewModifiers(mods);
      return;
    }
    // A third chord starts a new sequence; VS Code has at most two.
    if (recorded.length === 2) {
      recorded = [];
      recordedLabels = [];
    }
    const main = mainKey(e);
    // Default bindings may name the physical key as scan code, e.g. "ctrl+[equal]".
    recorded.push({ mods, mains: [...new Set([main, `[${e.code.toLowerCase()}]`])] });
    recordedLabels.push([...mods, main].map(keyLabel).join('+'));
    searchEl.value = recordedLabels.join(' ');
    vscode.postMessage({ type: 'search', keys: recorded });
  }

  searchEl.addEventListener('keyup', (e) => {
    // Releasing a modifier narrows the preview to the ones still held.
    if (recording && MODIFIER_CODES.test(e.code)) previewModifiers(heldModifiers(e));
  });

  learnedBox.open = !!state.learnedOpen;
  learnedBox.addEventListener('toggle', () => {
    saveState();
    scheduleLayout(); // hidden entries could not be measured while collapsed
  });

  // "toggle" does not bubble, so it is caught in the capture phase.
  areasEl.addEventListener('toggle', (e) => {
    const box = /** @type {HTMLDetailsElement} */ (e.target);
    const id = box.getAttribute('data-area');
    if (!id) return;
    if (box.open) openAreas.add(id);
    else openAreas.delete(id);
    saveState();
    scheduleLayout();
  }, true);

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg?.type !== 'data') return;
    platform = msg.platform;
    scanCodes = msg.scanCodes;
    layout = msg.layout;
    focusEl.innerHTML = msg.focus.length
      ? `<span class="focus-label">Learning focus:</span> ${msg.focus.map(esc).join(', ')}`
      : '<span class="focus-label">Choose what you want to learn …</span>';
    renderTip(msg.tip);
    usefulEl.innerHTML = msg.useful.length
      ? msg.useful.map((e) => renderEntry(e, false)).join('')
      : '<li class="empty">Nothing new right now – everything relevant is already learned.</li>';
    areasEl.innerHTML = msg.areaShortcuts.map((a) => `
      <details class="section" data-area="${esc(a.id)}"${openAreas.has(a.id) ? ' open' : ''}>
        <summary>Focus: ${esc(a.name)} (${a.entries.length})</summary>
        <ul class="list">${a.entries.map((e) => renderEntry(e, !!e.known, true)).join('')}</ul>
      </details>`).join('');
    learnedCountEl.textContent = String(msg.learned.length);
    learnedEl.innerHTML = msg.learned.map((e) => renderEntry(e, true)).join('');
    renderResults(msg.results, msg.resultCount);
    layoutEntries();
  });

  function renderResults(results, /** @type {number} */ count) {
    resultsEl.hidden = !results;
    mainEl.hidden = !!results;
    if (!results) return;
    resultsEl.innerHTML = results.length
      ? results.map((e) => renderEntry(e, !!e.known, true)).join('') +
        (count > results.length ? `<li class="empty">${count - results.length} more – refine the search to see them.</li>` : '')
      : '<li class="empty">No shortcut matches.</li>';
  }

  function renderTip(tip) {
    tipEl.hidden = !tip;
    tipTime = tip?.time;
    if (!tip) return;
    tipEl.innerHTML = `
      <div class="tip-head">
        <span>💡 Tip · <span class="tip-age">${timeAgo(tip.time)}</span></span>
        <button class="tip-close" title="Dismiss">✕</button>
      </div>
      <ul class="list">${renderEntry(tip, false)}</ul>`;
  }

  function timeAgo(/** @type {number} */ time) {
    const min = Math.round((Date.now() - time) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    return `${Math.round(min / 60)} h ago`;
  }

  // Keep the age of the tip current.
  setInterval(() => {
    const age = tipEl.querySelector('.tip-age');
    if (age && tipTime) age.textContent = timeAgo(tipTime);
  }, 30000);

  vscode.postMessage({ type: 'ready' });
  if (searchEl.value) vscode.postMessage({ type: 'search', query: searchEl.value });
})();
