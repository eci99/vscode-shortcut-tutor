// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const usefulEl = /** @type {HTMLElement} */ (document.getElementById('useful'));
  const learnedEl = /** @type {HTMLElement} */ (document.getElementById('learned'));
  const learnedCountEl = /** @type {HTMLElement} */ (document.getElementById('learned-count'));
  const learnedBox = /** @type {HTMLDetailsElement} */ (document.getElementById('learned-box'));
  const focusEl = /** @type {HTMLElement} */ (document.getElementById('focus'));
  const tipEl = /** @type {HTMLElement} */ (document.getElementById('tip'));
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

  function renderEntry(e, /** @type {boolean} */ known) {
    return `
      <li class="row${known ? ' known' : ''}" data-cmd="${esc(e.command)}">
        <div class="entry">
          <div class="title-cell">
            <span class="title" title="${esc(e.command)}">${esc(e.title)}</span>
            <button class="icon-btn edit-btn" title="Change shortcut in the Keyboard Shortcuts editor">✎</button>
            <button class="icon-btn known-btn" title="${known ? 'Undo – show in “Useful Now” and tips again' : 'Got it – remove from “Useful Now” and tips'}">${known ? '↺' : '✓'}</button>
          </div>
          <div class="reasons">${(e.reasons || []).map((r) => `<span class="reason" title="${esc(r)}">${esc(r)}</span>`).join('')}</div>
          <div class="keys">${e.keys.map((k, i) => `<span class="key">${i ? '<span class="or">or</span>' : ''}${renderKey(k)}</span>`).join('')}</div>
        </div>
      </li>`;
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

  function onRowClick(/** @type {boolean} */ known) {
    return (/** @type {MouseEvent} */ e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const command = target.closest('.row')?.getAttribute('data-cmd');
      if (!command) return;
      if (target.closest('.known-btn')) vscode.postMessage({ type: 'known', command, known: !known });
      else if (target.closest('.edit-btn')) vscode.postMessage({ type: 'edit', command });
    };
  }
  usefulEl.addEventListener('click', onRowClick(false));
  tipEl.addEventListener('click', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('.tip-close')) vscode.postMessage({ type: 'dismissTip' });
    else onRowClick(false)(e);
  });
  learnedEl.addEventListener('click', onRowClick(true));

  learnedBox.open = !!(vscode.getState() || {}).learnedOpen;
  learnedBox.addEventListener('toggle', () => {
    vscode.setState({ learnedOpen: learnedBox.open });
    scheduleLayout(); // hidden entries could not be measured while collapsed
  });

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
    learnedCountEl.textContent = String(msg.learned.length);
    learnedEl.innerHTML = msg.learned.map((e) => renderEntry(e, true)).join('');
    layoutEntries();
  });

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
})();
