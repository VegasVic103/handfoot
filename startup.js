/* The shared engine is adapted by the game server for browser use. Opening
 * index.html directly cannot start it, so explain how to open the running game
 * before loading any game code. */
(function () {
  'use strict';

  function showNotice(title, message) {
    var style = document.createElement('style');
    style.textContent =
      'body{overflow:auto!important}' +
      'body>:not(#startupNotice):not(script){display:none!important}' +
      '#startupNotice{box-sizing:border-box;width:calc(100% - 40px);max-width:500px;margin:10vh auto;padding:28px;border:1px solid #b79b67;border-radius:18px;background:#f6f0e2;color:#25342d;font:16px/1.6 Arial,sans-serif}' +
      '#startupNotice h1{margin:0 0 16px;font:600 32px/1.15 Georgia,serif;color:#25342d}' +
      '#startupNotice p{margin:0 0 16px}' +
      '#startupNotice code{font:14px/1.5 monospace;overflow-wrap:anywhere}' +
      '#startupNotice a{display:block;padding:12px 16px;border-radius:10px;background:#214632;color:#fff;text-align:center;text-decoration:none;font-weight:700}' +
      '#startupNotice a:focus-visible{outline:3px solid #886a31;outline-offset:4px}' +
      '#startupNotice small{display:block;margin-top:14px;font-size:13px}';
    document.head.appendChild(style);

    var notice = document.createElement('main');
    notice.id = 'startupNotice';
    notice.setAttribute('aria-labelledby', 'startupNoticeTitle');
    var heading = document.createElement('h1');
    heading.id = 'startupNoticeTitle';
    heading.textContent = title;
    heading.tabIndex = -1;
    notice.appendChild(heading);
    var explanation = document.createElement('p');
    explanation.textContent = message;
    notice.appendChild(explanation);
    document.body.appendChild(notice);
    heading.focus();
    return notice;
  }

  if (location.protocol === 'file:') {
    var notice = showNotice('Open the running game',
      'Hand & Foot needs its game server. This file is the game screen; open the running game to play.');
    var instruction = document.createElement('p');
    instruction.appendChild(document.createTextNode('In a terminal, open this project folder and run '));
    var command = document.createElement('code');
    command.textContent = 'npm start';
    instruction.appendChild(command);
    instruction.appendChild(document.createTextNode('. Then open the game below.'));
    notice.appendChild(instruction);
    var link = document.createElement('a');
    link.href = 'http://localhost:3000/';
    link.textContent = 'Open local game';
    notice.appendChild(link);
    var address = document.createElement('small');
    address.textContent = 'Default address: http://localhost:3000. If the server shows a different address, open that address instead.';
    notice.appendChild(address);
    return;
  }

  // Classic scripts preserve the globals shared by the client and menu.
  // Load each dependency before the next, just as the original script tags did.
  var sources = ['engine.js', 'app.js', 'menu.js'];
  function loadNext(index) {
    if (index === sources.length) return;
    var script = document.createElement('script');
    script.src = sources[index];
    script.onload = function () { loadNext(index + 1); };
    script.onerror = function () {
      var notice = showNotice('Could not open the game',
        'A game file could not be loaded. Check your connection, then reload to try again.');
      var retry = document.createElement('a');
      retry.href = location.href;
      retry.textContent = 'Reload game';
      notice.appendChild(retry);
    };
    document.body.appendChild(script);
  }
  loadNext(0);
})();
