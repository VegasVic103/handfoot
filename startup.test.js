'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./startup.js'), 'utf8');

function start(protocol) {
  const nodes = [];
  function element(tagName) {
    const node = {
      tagName, children: [],
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(key, value) { this[key] = value; },
      focus() { document.activeElement = this; },
    };
    nodes.push(node);
    return node;
  }
  const document = {
    head: element('head'), body: element('body'),
    createElement: element,
    createTextNode: textContent => ({ textContent }),
  };
  const location = { protocol, href: protocol + '//localhost:3000/?table=ABCD' };
  vm.runInNewContext(source, { document, location });
  return { document, location, nodes };
}

const file = start('file:');
assert.equal(file.nodes.filter(node => node.tagName === 'script').length, 0,
  'direct file opening never loads the engine, app, or menu');
assert.equal(file.location.protocol, 'file:', 'the guard does not redirect');
const notice = file.document.body.children[0];
assert.equal(notice.id, 'startupNotice');
assert.equal(notice.children[0].textContent, 'Open the running game');
assert.equal(file.document.activeElement, notice.children[0], 'the explanation receives keyboard focus');
assert.equal(file.nodes.find(node => node.tagName === 'code').textContent, 'npm start');
assert.equal(file.nodes.find(node => node.tagName === 'a').href, 'http://localhost:3000/');
assert.match(file.nodes.find(node => node.tagName === 'style').textContent,
  /body>:not\(#startupNotice\):not\(script\)\{display:none!important\}/,
  'the unusable game controls are hidden');

for (const protocol of ['http:', 'https:']) {
  const served = start(protocol);
  assert.equal(served.document.head.children.length, 0, 'normal startup does not add notice styling');
  for (const [index, expected] of ['engine.js', 'app.js', 'menu.js'].entries()) {
    assert.equal(served.document.body.children.length, index + 1,
      'later dependencies wait for the previous script to load');
    const script = served.document.body.children[index];
    assert.equal(script.tagName, 'script');
    assert.equal(script.src, expected);
    script.onload();
  }
  assert.equal(served.document.body.children.length, 3);
  assert.equal(served.nodes.some(node => node.id === 'startupNotice'), false,
    'normal gameplay has no file-mode message');
}

const failed = start('https:');
failed.document.body.children[0].onerror();
assert.equal(failed.nodes.filter(node => node.tagName === 'script').length, 1,
  'a failed dependency stops later game scripts from loading');
assert.equal(failed.nodes.find(node => node.id === 'startupNoticeTitle').textContent,
  'Could not open the game');
assert.equal(failed.nodes.find(node => node.tagName === 'a').href, failed.location.href,
  'retry preserves the current game address and invite');

console.log('Startup guard checks passed.');
