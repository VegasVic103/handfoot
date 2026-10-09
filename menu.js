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
  }

  function setupField(prefix, field) {
    var label = document.createElement('label');
    label.className = field.boolean ? 'menu-toggle setup-rule-toggle' : 'setup-rule-field';
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
      input.type = 'checkbox'; input.checked = !!window.E.DEFAULTS[field.key];
    } else {
      input.type = 'number'; input.min = String(field.min); input.max = String(field.max);
      input.step = '1'; input.required = true;
      input.inputMode = field.min < 0 ? 'text' : 'numeric';
      input.value = String(window.E.DEFAULTS[field.key] + (field.total ? 1 : 0));
    }
    if (field.help) {
      var help = document.createElement('small'); help.textContent = field.help;
      title.appendChild(help);
    }
    label.appendChild(input);
    return label;
  }

  function buildSetupRules(prefix, formId) {
    var area = byId(prefix + 'SetupRules');
    setupBase[prefix] = window.E.rulesForPreset('christine');
    var title = document.createElement('h3'); title.textContent = 'Game rules';
    area.appendChild(title);
    var presetLabel = document.createElement('label'); presetLabel.className = 'field'; presetLabel.setAttribute('for', prefix + 'RulePreset');
    var presetCaption = document.createElement('span'); presetCaption.textContent = 'Rule set'; presetLabel.appendChild(presetCaption);
    var preset = document.createElement('select'); preset.id = prefix + 'RulePreset';
    [['christine', 'Christine’s Rules'], ['real', 'Real Rules'], ['custom', 'Customized rules']].forEach(function (entry) {
      var option = document.createElement('option'); option.value = entry[0]; option.textContent = entry[1]; option.disabled = entry[0] === 'custom'; preset.appendChild(option);
    });
    preset.value = 'christine'; presetLabel.appendChild(preset); area.appendChild(presetLabel);
    var presetNote = document.createElement('p'); presetNote.className = 'setup-rules-note'; presetNote.id = prefix + 'PresetNote'; area.appendChild(presetNote);
    var differences = document.createElement('details'); differences.className = 'menu-rules';
    var diffSummary = document.createElement('summary'); diffSummary.textContent = 'Different from Christine’s'; differences.appendChild(diffSummary);
    var diffBody = document.createElement('div'); diffBody.id = prefix + 'PresetDifferences'; differences.appendChild(diffBody); area.appendChild(differences);
    preset.addEventListener('change', function () { applySetupPreset(prefix, preset.value); });
    var note = document.createElement('p'); note.className = 'setup-rules-note';
    note.textContent = 'Individual scoring. Set before the first deal. Pickup total includes the top discard.';
    area.appendChild(note);
    var main = document.createElement('div'); main.className = 'setup-rule-grid';
    mainRuleKeys.forEach(function (key) {
      main.appendChild(setupField(prefix, ruleFields.find(function (field) { return field.key === key; })));
    });
    area.appendChild(main);
    var more = document.createElement('details'); more.className = 'menu-rules setup-more-rules';
    var summary = document.createElement('summary'); summary.textContent = 'More rules';
    more.appendChild(summary);
    var advanced = document.createElement('div'); advanced.className = 'setup-advanced-rules';
    var groupName = 'Deal', group = null;
    ruleFields.forEach(function (field) {
      if (field.group) { groupName = field.group; group = null; }
      if (mainRuleKeys.includes(field.key) || field.key === 'revealPileTake') return;
      if (!group) {
        group = document.createElement('fieldset'); group.className = 'setup-rule-grid setup-rule-group';
        var heading = document.createElement('legend'); heading.textContent = groupName;
        group.appendChild(heading); advanced.appendChild(group);
      }
      group.appendChild(setupField(prefix, field));
    });
    var opening = document.createElement('fieldset'); opening.className = 'setup-opening';
    var legend = document.createElement('legend'); legend.textContent = 'Opening minimum by round';
    opening.appendChild(legend);
    window.E.DEFAULTS.minMelds.forEach(function (minimum, index) {
      var label = document.createElement('label'); label.className = 'setup-rule-field';
      var id = prefix + '-opening' + index;
      label.setAttribute('for', id); label.textContent = 'Round ' + (index + 1);
      var input = document.createElement('input'); input.id = id; input.type = 'number';
      input.min = '0'; input.max = '500'; input.step = '1'; input.required = true; input.inputMode = 'numeric';
      input.value = String(minimum); label.appendChild(input); opening.appendChild(label);
    });
    advanced.appendChild(opening); more.appendChild(advanced); area.appendChild(more);
    updateAutomaticDecks(prefix);
    syncSetupPreset(prefix);
    var form = byId(formId);
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
      ? 'Default house rules. Finish a book before starting another of the same rank.'
      : preset === 'real' ? 'Bicycle-based • individual scoring. Choosing this set replaces all rules below.'
      : 'Customized rules. Your current values are kept until you choose a rule set.';
    var target = byId(prefix + 'PresetDifferences');
    while (target.children.length) target.removeChild(target.children[0]);
    var standard = window.E.rulesForPreset('christine');
    ruleFields.forEach(function (field) {
      if (JSON.stringify(current[field.key]) === JSON.stringify(standard[field.key])) return;
      var line = document.createElement('p'); line.className = 'setup-rules-note';
      var value = field.boolean ? (current[field.key] ? 'On' : 'Off') : Number(current[field.key]) + (field.total ? 1 : 0);
      line.textContent = field.label + ': ' + value + (field.help ? ' — ' + field.help : ''); target.appendChild(line);
    });
    if (JSON.stringify(current.minMelds) !== JSON.stringify(standard.minMelds)) {
      var line = document.createElement('p'); line.className = 'setup-rules-note'; line.textContent = 'Opening minimums: ' + current.minMelds.join(' / '); target.appendChild(line);
    }
    target.parentNode.hidden = !target.children.length;
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
    var next = byId('menu-' + page);
    if (!next) return;
    if (page === 'host' && currentPage !== 'host') applySetupPreset('host', 'christine');
    if (page === 'computer' && currentPage !== 'computer') applySetupPreset('bot', 'christine');
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
