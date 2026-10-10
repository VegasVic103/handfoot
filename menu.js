/* Progressive menu navigation. The original app remains responsible for the
 * connection, game state, cards, rules, and personal preferences. */
(function () {
  'use strict';
  var byId = function (id) { return document.getElementById(id); };
  var currentPage = 'home';
  var pending = false;
  var pendingTimer = null;
  var submitIds = ['createBtn', 'joinBtn', 'vsBotBtn'];
  // app.js is loaded first and supplies the same field definitions used by
  // the in-game editor. Prefix every setup ID so all three editors can coexist.
  var ruleFields = window.RULE_CONFIG_FIELDS;
  var setupBase = {};
  var mainRuleKeys = ['deckCount', 'requireRedBook', 'requireBlackBook', 'pileTakeExtra'];
  var mainRuleLabels = {
    deckCount: 'Decks', requireRedBook: 'Red books required',
    requireBlackBook: 'Black books required', pileTakeExtra: 'Discard pickup total',
  };

  function setupSeats(prefix) {
    return Number(byId(prefix === 'host' ? 'seatCount' : 'botCount').value) + (prefix === 'bot' ? 1 : 0);
  }

  function clearSetupError(prefix) {
    byId(prefix + 'RulesError').hidden = true;
  }

  function updateAutomaticDecks(prefix) {
    byId(prefix + '-automaticDecks').textContent = 'Auto · ' + (setupSeats(prefix) + 2) + ' decks';
    var total = setupSeats(prefix), others = total - 1;
    byId(prefix + 'SeatsHint').textContent = prefix === 'host'
      ? 'You + ' + others + (others === 1 ? ' friend' : ' friends')
      : total + ' players, including you';
  }

  function setupField(prefix, field) {
    var label = document.createElement('label');
    label.className = field.boolean ? 'menu-toggle setup-rule-toggle setup-rule-row' : 'setup-rule-field setup-rule-row';
    label.setAttribute('data-rule-key', field.key);
    var id = prefix + '-' + field.id;
    label.setAttribute('for', id);
    var title = document.createElement('span');
    title.textContent = mainRuleLabels[field.key] || field.label;
    label.appendChild(title);
    var input = document.createElement(field.deck || field.options ? 'select' : 'input');
    input.id = id; input.name = field.key;
    if (field.options) {
      field.options.forEach(function (value) { var option = document.createElement('option'); option.value = String(value); option.textContent = value === 1 ? 'One stock' : 'Four piles'; input.appendChild(option); });
      input.value = String(window.E.DEFAULTS[field.key]);
    } else if (field.deck) {
      for (var count = 0; count <= field.max; count++) {
        var option = document.createElement('option'); option.value = String(count);
        option.textContent = count ? count + (count === 1 ? ' deck' : ' decks') : 'Automatic';
        if (!count) option.id = prefix + '-automaticDecks';
        input.appendChild(option);
      }
      input.value = String(window.E.DEFAULTS[field.key]);
    } else if (field.boolean) {
      input.type = 'checkbox'; input.setAttribute('role', 'switch'); input.checked = !!window.E.DEFAULTS[field.key];
    } else {
      input.type = 'number'; input.min = String(field.min); input.max = String(field.max);
      input.step = '1'; input.required = true;
      input.inputMode = field.min < 0 ? 'text' : 'numeric';
      input.value = String(window.E.DEFAULTS[field.key] + (field.total ? 1 : 0));
    }
    var explanation = field.key === 'pileTakeExtra' ? 'Includes the top discard.' : field.help;
    if (explanation) {
      var help = document.createElement('small'); help.textContent = explanation;
      title.appendChild(help);
    }
    label.appendChild(input);
    return label;
  }

  function buildSetupRules(prefix, formId) {
    var area = byId(prefix + 'SetupRules');
    setupBase[prefix] = window.E.rulesForPreset('christine');
    var title = document.createElement('h3'); title.textContent = 'Choose rules';
    area.appendChild(title);
    var presetLabel = document.createElement('label'); presetLabel.className = 'field'; presetLabel.setAttribute('for', prefix + 'RulePreset');
    var presetCaption = document.createElement('span'); presetCaption.className = 'sr-only'; presetCaption.textContent = 'Rule set'; presetLabel.appendChild(presetCaption);
    var preset = document.createElement('select'); preset.id = prefix + 'RulePreset';
    [['christine', 'House Rules'], ['real', 'Real Rules'], ['custom', 'Customized rules']].forEach(function (entry) {
      var option = document.createElement('option'); option.value = entry[0]; option.textContent = entry[1]; option.disabled = entry[0] === 'custom'; preset.appendChild(option);
    });
    preset.value = 'christine'; presetLabel.appendChild(preset); area.appendChild(presetLabel);
    var presetNote = document.createElement('p'); presetNote.className = 'setup-rules-note'; presetNote.id = prefix + 'PresetNote'; area.appendChild(presetNote);
    var overview = document.createElement('dl'); overview.className = 'setup-rule-overview';
    overview.id = prefix + 'RuleOverview';
    mainRuleKeys.forEach(function (key) {
      var cell = document.createElement('div'), name = document.createElement('dt'), value = document.createElement('dd');
      name.textContent = mainRuleLabels[key]; value.id = prefix + '-summary-' + key;
      cell.appendChild(name); cell.appendChild(value); overview.appendChild(cell);
    });
    area.appendChild(overview);
    var customize = document.createElement('details'); customize.className = 'menu-rules setup-customize'; customize.id = prefix + 'CustomizeRules';
    var customizeTitle = document.createElement('summary'); customizeTitle.textContent = 'Customize rules'; customizeTitle.id = prefix + 'CustomizeTitle';
    var optional = document.createElement('span'); optional.id = prefix + 'CustomizationCount'; optional.textContent = 'Optional'; customizeTitle.appendChild(optional);
    customize.appendChild(customizeTitle);
    var customBody = document.createElement('div'); customBody.className = 'setup-customize-body'; customize.appendChild(customBody); area.appendChild(customize);
    preset.addEventListener('change', function () { applySetupPreset(prefix, preset.value); });
    var note = document.createElement('p'); note.className = 'setup-editor-note';
    note.textContent = 'Set the rules for everyone at this table.'; customBody.appendChild(note);
    // A single reading surface: related controls stay together, with no
    // hidden Advanced submenu or repeated editable copies of a rule.
    var groups = [
      { title: 'The deal', note: 'Cards and draw piles.', keys: ['deckCount', 'stockPiles', 'handSize', 'footSize'] },
      { title: 'Melds & books', note: 'Build books and qualify to go out.', keys: ['requireRedBook', 'requireBlackBook', 'bookSize', 'maxWildsInBook', 'minNaturalsInMeld', 'minNaturalsWithWild', 'closedBooksLocked', 'goOutWithDiscard'] },
      { title: 'Draw & discard', note: 'Pickup, preview and reshuffling.', keys: ['pileTakeExtra', 'revealPileTake', 'reshuffleOnce'] },
      { title: 'Opening points', note: 'Minimum points to lay your first melds each round.', opening: true },
      { title: 'Scoring & red threes', note: 'Book bonuses and special-card rules.', keys: ['redBookBonus', 'blackBookBonus', 'goOutBonus', 'redThreeValue', 'highEightNine', 'redThreeAutoLayOff', 'redThreeBonus'] },
    ];
    groups.forEach(function (definition) {
      var group = document.createElement('fieldset'); group.className = 'setup-editor-group';
      var legend = document.createElement('legend'); legend.textContent = definition.title; group.appendChild(legend);
      var subtitle = document.createElement('p'); subtitle.className = 'setup-group-note'; subtitle.textContent = definition.note; group.appendChild(subtitle);
      var rows = document.createElement('div'); rows.className = definition.opening ? 'setup-opening-grid' : 'setup-editor-rows';
      if (definition.opening) {
        window.E.DEFAULTS.minMelds.forEach(function (minimum, index) {
          var label = document.createElement('label'); label.className = 'setup-rule-field setup-opening-field';
          var id = prefix + '-opening' + index; label.setAttribute('for', id);
          var caption = document.createElement('span'); caption.textContent = 'Round ' + (index + 1); label.appendChild(caption);
          var input = document.createElement('input'); input.id = id; input.type = 'number';
          input.min = '0'; input.max = '500'; input.step = '1'; input.required = true; input.inputMode = 'numeric';
          input.value = String(minimum); label.appendChild(input); rows.appendChild(label);
        });
      } else definition.keys.forEach(function (key) {
        var field = ruleFields.find(function (item) { return item.key === key; });
        if (key === 'revealPileTake') {
          var revealLabel = byId(prefix + 'Reveal').closest('label');
          revealLabel.className = 'menu-toggle setup-rule-toggle setup-rule-row';
          revealLabel.setAttribute('data-rule-key', key); byId(prefix + 'Reveal').setAttribute('role', 'switch');
          rows.appendChild(revealLabel);
        } else rows.appendChild(setupField(prefix, field));
      });
      group.appendChild(rows); customBody.appendChild(group);
    });
    var reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn ghost sm setup-reset';
    reset.id = prefix + 'ResetRules'; reset.textContent = 'Reset to House Rules';
    reset.onclick = function () { applySetupPreset(prefix, 'christine'); };
    var editorEnd = document.createElement('div'); editorEnd.className = 'setup-editor-end';
    editorEnd.appendChild(reset);
    var done = document.createElement('button'); done.type = 'button'; done.className = 'btn ghost setup-editor-done';
    done.id = prefix + 'RulesDone'; done.textContent = 'Done';
    done.onclick = function () { customize.open = false; customizeTitle.focus({ preventScroll: false }); };
    editorEnd.appendChild(done); customBody.appendChild(editorEnd);
    var form = byId(formId), footer = document.createElement('div'); footer.className = 'setup-submit-footer';
    footer.id = prefix + 'SetupFooter';
    var footerNote = document.createElement('p'); footerNote.className = 'setup-submit-note'; footerNote.id = prefix + 'SubmitSummary';
    footer.appendChild(footerNote);
    footer.appendChild(byId(prefix + 'RulesError'));
    footer.appendChild(byId(prefix === 'host' ? 'createBtn' : 'vsBotBtn'));
    form.appendChild(footer);
    // A native validation error inside a closed disclosure must be made visible
    // before the browser attempts to focus its field.
    form.addEventListener('invalid', function (event) {
      revealSetupField(event.target);
    }, true);
    updateAutomaticDecks(prefix);
    syncSetupPreset(prefix);
    ['input', 'change'].forEach(function (eventName) {
      form.addEventListener(eventName, function (event) {
        // Native selects emit input before change. Do not infer the old preset
        // from the fields while the newly chosen preset is still being applied.
        if (event && event.target === preset) return;
        clearSetupError(prefix); updateAutomaticDecks(prefix); syncSetupPreset(prefix);
      });
    });
  }

  function applySetupPreset(prefix, id) {
    var chosen = window.E.rulesForPreset(id); if (!chosen) return;
    setupBase[prefix] = chosen;
    ruleFields.forEach(function (field) {
      var input = byId(field.key === 'revealPileTake' ? prefix + 'Reveal' : prefix + '-' + field.id);
      if (field.boolean) input.checked = !!chosen[field.key];
      else input.value = String(Number(chosen[field.key]) + (field.total ? 1 : 0));
    });
    chosen.minMelds.forEach(function (minimum, index) { byId(prefix + '-opening' + index).value = String(minimum); });
    clearSetupError(prefix); updateAutomaticDecks(prefix); syncSetupPreset(prefix);
  }

  function syncSetupPreset(prefix) {
    var current = readSetupRules(prefix), preset = window.E.rulePresetId(current);
    byId(prefix + 'RulePreset').value = preset;
    byId(prefix + 'PresetNote').textContent = preset === 'christine'
      ? 'Default house rules. Ready to play as they are.'
      : preset === 'real' ? 'Bicycle-based · Individual scoring'
      : 'Your customized rules. Changes stay when you go back.';
    var printable = function (value) { return Number.isFinite(value) ? String(value) : '—'; };
    byId(prefix + '-summary-deckCount').textContent = current.deckCount === 0
      ? 'Auto · ' + (setupSeats(prefix) + 2) : printable(current.deckCount);
    byId(prefix + '-summary-requireRedBook').textContent = printable(current.requireRedBook);
    byId(prefix + '-summary-requireBlackBook').textContent = printable(current.requireBlackBook);
    byId(prefix + '-summary-pileTakeExtra').textContent = printable(current.pileTakeExtra + 1) + ' cards';
    var others = setupSeats(prefix) - 1;
    byId(prefix + 'SubmitSummary').textContent = prefix === 'host'
      ? 'Next: share your code with ' + others + (others === 1 ? ' friend.' : ' friends.')
      : 'You + ' + others + (others === 1 ? ' computer. ' : ' computers. ') + 'Choose your foot, then play.';
    byId(prefix + 'ResetRules').hidden = preset === 'christine';
    var standard = window.E.rulesForPreset('christine');
    var count = ruleFields.filter(function (field) {
      return JSON.stringify(current[field.key]) !== JSON.stringify(standard[field.key]);
    }).length;
    if (JSON.stringify(current.minMelds) !== JSON.stringify(standard.minMelds)) count++;
    byId(prefix + 'CustomizationCount').textContent = count ? count + (count === 1 ? ' change' : ' changes') : 'Optional';
    ruleFields.forEach(function (field) {
      var input = byId(field.key === 'revealPileTake' ? prefix + 'Reveal' : prefix + '-' + field.id);
      input.closest('label').setAttribute('data-changed', JSON.stringify(current[field.key]) !== JSON.stringify(standard[field.key]) ? 'true' : 'false');
    });
    current.minMelds.forEach(function (minimum, index) {
      byId(prefix + '-opening' + index).closest('label').setAttribute('data-changed', minimum !== standard.minMelds[index] ? 'true' : 'false');
    });
  }

  function revealSetupField(field) {
    var parent = field && field.parentNode;
    while (parent) {
      if (String(parent.tagName).toLowerCase() === 'details') parent.open = true;
      parent = parent.parentNode;
    }
  }

  function readSetupRules(prefix) {
    var rules = Object.assign({}, setupBase[prefix]);
    ruleFields.forEach(function (field) {
      var input = byId(field.key === 'revealPileTake' ? prefix + 'Reveal' : prefix + '-' + field.id);
      if (field.boolean) rules[field.key] = !!input.checked;
      else {
        var raw = String(input.value).trim();
        rules[field.key] = raw === '' ? NaN : Number(raw) - (field.total ? 1 : 0);
      }
    });
    rules.distinctDrawPiles = rules.stockPiles === 1 ? 1 : 2;
    rules.minMelds = [0, 1, 2, 3].map(function (index) {
      var raw = String(byId(prefix + '-opening' + index).value).trim();
      return raw === '' ? NaN : Number(raw);
    });
    return rules;
  }

  function submitSetup(form, prefix, nameId, payload, status) {
    if (pending) return;
    var rules = readSetupRules(prefix);
    var checked = window.E.validateSettings(rules, setupSeats(prefix));
    if (!checked.ok) {
      byId(prefix + 'CustomizeRules').open = true;
      var error = byId(prefix + 'RulesError');
      error.textContent = checked.reason; error.hidden = false; error.focus({ preventScroll: false });
      return;
    }
    clearSetupError(prefix);
    payload.rules = rules;
    submit(form, nameId, payload, status);
  }

  buildSetupRules('host', 'hostForm');
  buildSetupRules('bot', 'computerForm');

  function finishRequest() {
    pending = false;
    clearTimeout(pendingTimer);
    submitIds.forEach(function (id) { byId(id).disabled = false; });
    byId('menuStatus').hidden = true;
    document.querySelectorAll('.menu-form').forEach(function (form) { form.removeAttribute('aria-busy'); });
  }

  function goTo(page, focus) {
    // Older links and callers can still use the former friends hub; its two
    // actions now live directly beside Practice on the Play page.
    if (page === 'friends') page = 'play';
    var next = byId('menu-' + page);
    if (!next) return;
    // Drafts belong to the setup session, not to a single page visit. The
    // initial construction supplies House Rules; only an explicit choice resets.
    currentPage = page;
    byId('lobby').setAttribute('data-menu-page', page);
    document.querySelectorAll('.menu-page').forEach(function (el) { el.hidden = el !== next; });
    byId('lobbyErr').hidden = true;
    // Setup can be taller than a phone. A new page always starts at its heading,
    // including Back after editing the additional rules farther down the form.
    byId('lobby').scrollTop = 0;
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    if (focus !== false) {
      var target = next.querySelector('h2') || byId('homePlay');
      target.focus({ preventScroll: true });
    }
  }

  window.HFMenu = {
    goTo: goTo,
    showHome: function () {
      finishRequest();
      // Leaving a table closes sheets synchronously; their observer runs later.
      // Release the old modal's inert state before restoring focus to Play.
      if (!document.querySelector('.sheet:not([hidden])')) {
        byId('lobby').inert = false;
        byId('table').inert = false;
      }
      goTo('home');
    },
    finishRequest: finishRequest,
  };

  document.querySelectorAll('[data-menu-to]').forEach(function (button) {
    button.addEventListener('click', function () { goTo(button.getAttribute('data-menu-to')); });
  });
  byId('homeSettings').onclick = function () { window.openRules('settings'); };
  byId('homeRules').onclick = function () { window.openRules('rules'); };

  // Form submission works equally with the button, a keyboard, or Return on iOS.
  submitIds.forEach(function (id) { byId(id).onclick = null; });
  function submit(form, nameId, payload, status) {
    if (pending) return;
    var nameInput = byId(nameId);
    nameInput.value = nameInput.value.trim();
    if (!form.reportValidity()) return;
    payload.name = nameInput.value;
    byId('lobbyErr').hidden = true;
    if (!window.send(payload)) return;
    try { localStorage.setItem('hf_name', payload.name); } catch (e) {}
    ['hostName', 'joinName', 'botName'].forEach(function (id) { byId(id).value = payload.name; });
    pending = true;
    form.setAttribute('aria-busy', 'true');
    submitIds.forEach(function (id) { byId(id).disabled = true; });
    byId('menuStatus').textContent = status;
    byId('menuStatus').hidden = false;
    // A dropped connection must never leave the menu permanently disabled.
    pendingTimer = setTimeout(finishRequest, 10000);
  }
  byId('hostForm').addEventListener('submit', function (event) {
    event.preventDefault();
    submitSetup(this, 'host', 'hostName', { t: 'create', seats: byId('seatCount').value,
      revealDiscard: byId('hostReveal').checked }, 'Creating your table…');
  });
  byId('joinForm').addEventListener('submit', function (event) {
    event.preventDefault();
    byId('joinCode').value = byId('joinCode').value.trim().toUpperCase();
    submit(this, 'joinName', { t: 'join', code: byId('joinCode').value }, 'Joining the table…');
  });
  byId('computerForm').addEventListener('submit', function (event) {
    event.preventDefault();
    submitSetup(this, 'bot', 'botName', { t: 'vsbot', bots: byId('botCount').value,
      revealDiscard: byId('botReveal').checked }, 'Dealing your game…');
  });

  new MutationObserver(function () { if (!byId('lobbyErr').hidden) finishRequest(); })
    .observe(byId('lobbyErr'), { attributes: true, childList: true, subtree: true });
  new MutationObserver(function () { if (byId('lobby').hidden) finishRequest(); })
    .observe(byId('lobby'), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(function () { if (!byId('connBar').hidden) finishRequest(); })
    .observe(byId('connBar'), { attributes: true, attributeFilter: ['hidden'] });

  try {
    var savedName = localStorage.getItem('hf_name');
    if (savedName) ['hostName', 'joinName', 'botName'].forEach(function (id) {
      byId(id).value = savedName.slice(0, 14);
    });
  } catch (e) {}

  // Invite links go straight to the joining form, with the original app's code.
  if (byId('joinCode').value.length === 4) goTo('join', false);

  // Existing sheets toggle the hidden attribute. Manage focus centrally without
  // changing the original handlers or taking focus away from a chat text field.
  var openSheets = [];
  var lastOutsideFocus = document.activeElement;
  var background = [byId('lobby'), byId('table')];
  var focusable = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex]:not([tabindex="-1"])';
  function targets(sheet) {
    return Array.prototype.filter.call(sheet.querySelectorAll(focusable), function (el) {
      return !el.closest('[hidden]') && el.getClientRects().length;
    });
  }
  document.addEventListener('focusin', function (event) {
    if (!event.target.closest('.sheet')) lastOutsideFocus = event.target;
  });
  function syncSheets() {
    var all = document.querySelectorAll('.sheet');
    all.forEach(function (sheet) {
      var index = openSheets.findIndex(function (item) { return item.sheet === sheet; });
      if (!sheet.hidden && index === -1) {
        var active = document.activeElement;
        openSheets.push({ sheet: sheet, returnTo: sheet.contains(active) ? lastOutsideFocus : active });
        background.forEach(function (el) { el.inert = true; });
        if (!sheet.contains(document.activeElement)) {
          var first = targets(sheet)[0];
          if (first) first.focus({ preventScroll: true });
        }
      } else if (sheet.hidden && index !== -1) {
        var old = openSheets.splice(index, 1)[0];
        if (!openSheets.length) background.forEach(function (el) { el.inert = false; });
        if (old.returnTo && old.returnTo.isConnected && !old.returnTo.closest('[hidden]')) {
          old.returnTo.focus({ preventScroll: true });
        }
      }
    });
  }
  document.querySelectorAll('.sheet').forEach(function (sheet) {
    new MutationObserver(syncSheets).observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
    sheet.addEventListener('click', function (event) {
      if (event.target === sheet) {
        var close = sheet.querySelector('[id^="close"]');
        if (close) close.click();
      }
    });
  });
  document.addEventListener('keydown', function (event) {
    var top = openSheets[openSheets.length - 1];
    if (top) {
      if (event.key === 'Escape') {
        event.preventDefault();
        var close = top.sheet.querySelector('[id^="close"]');
        if (close) close.click();
      } else if (event.key === 'Tab') {
        var items = targets(top.sheet);
        if (!items.length) return event.preventDefault();
        var first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !top.sheet.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !top.sheet.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    } else if (event.key === 'Escape' && !byId('lobby').hidden && currentPage !== 'home') {
      event.preventDefault();
      var back = byId('menu-' + currentPage).querySelector('.menu-back');
      if (back) back.click();
    }
  });
})();
