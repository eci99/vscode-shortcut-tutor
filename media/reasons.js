// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const content = /** @type {HTMLElement} */ (document.getElementById('content'));
  const datalist = /** @type {HTMLElement} */ (document.getElementById('all-commands'));
  const nav = /** @type {HTMLElement} */ (document.getElementById('nav'));
  const header = /** @type {HTMLElement} */ (document.querySelector('header'));

  /** @type {Record<string, any>} */
  let defaults = {};
  /** @type {Record<string, { title: string, key?: string }>} */
  let commands = {};
  /** @type {{ id: string, name: string }[]} */
  let areas = [];

  // [kind, heading, hint, short name in the navigation]
  const SECTIONS = [
    // Single-card sections need no heading of their own.
    ['general', '', '', 'General'],
    ['focus', '', '', 'Learning focus'],
    ['essentials', '', '', 'Base importance'],
    ['context', 'Situation from shortcut conditions', 'A shortcut gets the bonus when its when clause requires this situation and it currently applies.', 'Conditions'],
    ['signal', 'Situation signals', 'Situations that raise specific commands, independent of their when clause.', 'Signals'],
    ['nudge', 'Detected workflows', 'Workflows that would be faster with a shortcut. They raise the suggested command and can trigger a tip.', 'Workflows'],
  ];

  function esc(/** @type {unknown} */ s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
  }

  /** Title and key of a command, or a warning if it has no shortcut. */
  function preview(/** @type {string} */ command) {
    if (!command) return '';
    const info = commands[command];
    if (!info) return '<span class="warn">no shortcut found</span>';
    return `${esc(info.title)}${info.key ? ` · <span class="key">${esc(info.key)}</span>` : ''}`;
  }

  /** Lists the placeholders the default label uses, e.g. "{count} problem{s}" → "{count} {s}". */
  function placeholderHint(/** @type {string | undefined} */ label) {
    const found = [...new Set((label || '').match(/\{(value|count|s)\}/g) || [])];
    return found.length ? `<span class="unit">placeholders: ${found.join(' ')}</span>` : '';
  }

  function numberInput(/** @type {string} */ field, /** @type {any} */ p) {
    return `
      <label class="param">
        <span>${esc(p.label)}</span>
        <input type="number" data-field="${esc(field)}" value="${p.value}" min="${p.min ?? 0}" step="${p.step ?? 1}">
        ${p.unit ? `<span class="unit">${esc(p.unit)}</span>` : ''}
      </label>`;
  }

  function commandRow(/** @type {string} */ command, /** @type {number} */ value, /** @type {string} */ valueLabel) {
    return `
      <div class="cmd-row">
        <input class="cmd-id" list="all-commands" value="${esc(command)}" placeholder="command id" spellcheck="false">
        <label class="cmd-val"><span>${esc(valueLabel)}</span><input type="number" value="${value}" step="1"></label>
        <span class="cmd-preview">${preview(command)}</span>
        <button class="icon remove" title="Remove">✕</button>
      </div>`;
  }

  function renderCard(r) {
    const isGeneral = r.kind === 'general';
    const valueLabel = r.kind === 'essentials' ? 'weight' : 'bonus';
    const entries = Object.entries(r.commands || {});
    if (r.kind === 'essentials') entries.sort((a, b) => b[1] - a[1]);
    return `
      <section class="card" id="reason-${esc(r.id)}" data-id="${esc(r.id)}">
        <div class="card-head">
          ${isGeneral ? `<h3>${esc(r.name)}</h3>` : `
            <label class="toggle"><input type="checkbox" data-field="enabled" ${r.enabled ? 'checked' : ''}> <h3>${esc(r.name)}</h3></label>`}
          <span class="modified" hidden>modified</span>
          <button class="secondary reset" title="Reset to default">Reset</button>
        </div>
        <p class="desc">${esc(r.description)}${r.contextKeys ? ` <code>${r.contextKeys.map(esc).join('</code> / <code>')}</code>` : ''}</p>
        <div class="fields">
          ${isGeneral ? '' : `
            <label class="param wide">
              <span>Shown as</span>
              <input type="text" data-field="label" value="${esc(r.label)}">
              ${placeholderHint(defaults[r.id]?.label)}
            </label>`}
          ${r.kind === 'context' || r.kind === 'focus' ? numberInput('bonus', { label: 'Bonus', value: r.bonus }) : ''}
          ${Object.entries(r.params).map(([key, p]) => numberInput('param:' + key, p)).join('')}
          ${r.kind === 'nudge' ? `
            <label class="param wide">
              <span>Suggests</span>
              <input type="text" data-field="command" list="all-commands" value="${esc(r.command)}" spellcheck="false">
              <span class="cmd-preview">${preview(r.command)}</span>
            </label>` : ''}
        </div>
        ${r.kind === 'focus' ? `
          <div class="areas">
            ${areas.map((a) => `
              <label class="area"><input type="checkbox" data-area="${esc(a.id)}" ${r.areas?.includes(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}
          </div>` : ''}
        ${r.commands ? `
          <details class="cmds"${r.kind === 'essentials' ? '' : ' open'}>
            <summary>Commands (<span class="cmd-count">${entries.length}</span>)</summary>
            <div class="cmd-list">
              ${entries.map(([c, v]) => commandRow(c, v, valueLabel)).join('')}
            </div>
            <button class="secondary add" data-label="${valueLabel}">+ Add command</button>
          </details>` : ''}
      </section>`;
  }

  /** Reads the current state of a card from its inputs. */
  function readCard(/** @type {HTMLElement} */ card) {
    const value = { params: {} };
    card.querySelectorAll('[data-field]').forEach((el) => {
      const input = /** @type {HTMLInputElement} */ (el);
      const field = input.dataset.field || '';
      if (field === 'enabled') value.enabled = input.checked;
      else if (field === 'label' || field === 'command') value[field] = input.value.trim();
      else if (field === 'bonus') value.bonus = Number(input.value);
      else if (field.startsWith('param:')) value.params[field.slice(6)] = Number(input.value);
    });
    const areaInputs = /** @type {NodeListOf<HTMLInputElement>} */ (card.querySelectorAll('[data-area]'));
    if (areaInputs.length) {
      value.areas = [...areaInputs].filter((i) => i.checked).map((i) => i.dataset.area);
    }
    const list = card.querySelector('.cmd-list');
    if (list) {
      value.commands = {};
      list.querySelectorAll('.cmd-row').forEach((row) => {
        const id = /** @type {HTMLInputElement} */ (row.querySelector('.cmd-id')).value.trim();
        const v = Number(/** @type {HTMLInputElement} */ (row.querySelector('.cmd-val input')).value);
        if (id) value.commands[id] = v;
      });
    }
    return value;
  }

  /** Compares a card with its default to show the "modified" badge. */
  function updateModified(/** @type {HTMLElement} */ card) {
    const def = defaults[card.dataset.id || ''];
    const v = readCard(card);
    const modified =
      (v.enabled !== undefined && v.enabled !== def.enabled) ||
      (v.label !== undefined && v.label !== def.label) ||
      (v.command !== undefined && v.command !== def.command) ||
      (v.bonus !== undefined && v.bonus !== def.bonus) ||
      Object.entries(v.params).some(([k, n]) => n !== def.params[k]?.value) ||
      (v.commands !== undefined && JSON.stringify(sortKeys(v.commands)) !== JSON.stringify(sortKeys(def.commands))) ||
      (v.areas !== undefined && JSON.stringify([...v.areas].sort()) !== JSON.stringify([...(def.areas || [])].sort()));
    /** @type {HTMLElement} */ (card.querySelector('.modified')).hidden = !modified;
    card.classList.toggle('disabled', v.enabled === false);
    const link = nav.querySelector(`a[href="#${card.id}"]`);
    link?.classList.toggle('is-modified', modified);
    link?.classList.toggle('disabled', v.enabled === false);
  }

  function sortKeys(/** @type {Record<string, number>} */ o) {
    return Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => a.localeCompare(b)));
  }

  /** @type {Map<string, number>} */
  const timers = new Map();
  function scheduleSave(/** @type {HTMLElement} */ card) {
    const id = card.dataset.id || '';
    updateModified(card);
    const count = card.querySelector('.cmd-count');
    if (count) count.textContent = String(card.querySelectorAll('.cmd-row').length);
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => vscode.postMessage({ type: 'save', id, value: readCard(card) }), 400));
  }

  function render(reasons) {
    content.innerHTML = SECTIONS.map(([kind, title, hint]) => {
      const cards = reasons.filter((r) => r.kind === kind);
      if (!cards.length) return '';
      return `
        ${title ? `<h2 id="section-${kind}">${esc(title)}</h2>` : ''}
        ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
        ${cards.map(renderCard).join('')}`;
    }).join('');
    renderNav(reasons);
    content.querySelectorAll('.card').forEach((c) => updateModified(/** @type {HTMLElement} */ (c)));
    observeCards();
  }

  /** Single-card sections link straight to their card; the others list their cards below a heading link. */
  function renderNav(reasons) {
    nav.innerHTML = SECTIONS.map(([kind, title, , short]) => {
      const cards = reasons.filter((r) => r.kind === kind);
      if (!cards.length) return '';
      if (!title) {
        return `<a class="nav-section" href="#reason-${esc(cards[0].id)}">${esc(short)}</a>`;
      }
      return `
        <a class="nav-section" href="#section-${kind}">${esc(short)}</a>
        <ul>${cards.map((r) => `<li><a href="#reason-${esc(r.id)}">${esc(r.name)}</a></li>`).join('')}</ul>`;
    }).join('');
  }

  // --- Highlight the card at the top of the viewport in the navigation -------
  /** @type {IntersectionObserver | undefined} */
  let observer;
  const visibleCards = new Set();

  function observeCards() {
    observer?.disconnect();
    visibleCards.clear();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visibleCards.add(e.target);
        else visibleCards.delete(e.target);
      }
      // The topmost visible card wins.
      const top = [...visibleCards].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      nav.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
      if (top) {
        const link = nav.querySelector(`a[href="#${top.id}"]`);
        link?.classList.add('active');
        link?.scrollIntoView({ block: 'nearest' });
      }
    }, { rootMargin: `-${header.offsetHeight}px 0px -40% 0px` });
    content.querySelectorAll('.card').forEach((c) => observer?.observe(c));
  }

  nav.addEventListener('click', (e) => {
    const link = /** @type {HTMLElement} */ (e.target).closest('a');
    if (!link) return;
    e.preventDefault();
    document.querySelector(link.getAttribute('href') || '')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Sticky offsets depend on the header height, which changes when it wraps.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  }).observe(header);

  content.addEventListener('input', (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    const card = /** @type {HTMLElement | null} */ (target.closest('.card'));
    if (!card) return;
    // Live preview of the command next to the input.
    if (target.classList.contains('cmd-id') || target.dataset.field === 'command') {
      const previewEl = target.parentElement?.querySelector('.cmd-preview');
      if (previewEl) previewEl.innerHTML = preview(target.value.trim());
    }
    scheduleSave(card);
  });

  content.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const card = /** @type {HTMLElement | null} */ (target.closest('.card'));
    if (!card) return;
    if (target.closest('.reset')) {
      clearTimeout(timers.get(card.dataset.id || ''));
      vscode.postMessage({ type: 'reset', id: card.dataset.id });
    } else if (target.closest('.remove')) {
      target.closest('.cmd-row')?.remove();
      scheduleSave(card);
    } else if (target.closest('.add')) {
      const list = /** @type {HTMLElement} */ (card.querySelector('.cmd-list'));
      list.insertAdjacentHTML('beforeend', commandRow('', 3, target.dataset.label || 'bonus'));
      /** @type {HTMLInputElement} */ (list.lastElementChild?.querySelector('.cmd-id')).focus();
    }
  });

  /** @type {HTMLElement} */ (document.getElementById('reset-all')).addEventListener('click', () => {
    vscode.postMessage({ type: 'resetAll' });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg?.type !== 'init') return;
    defaults = Object.fromEntries(msg.defaults.map((d) => [d.id, d]));
    commands = msg.commands;
    areas = msg.areas;
    datalist.innerHTML = Object.entries(commands)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, info]) => `<option value="${esc(id)}">${esc(info.title)}</option>`)
      .join('');
    const scroll = window.scrollY;
    render(msg.reasons);
    window.scrollTo(0, scroll);
  });

  vscode.postMessage({ type: 'ready' });
})();
