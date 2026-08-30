'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { pickCopiedText, shouldTranslate, pickCopiedTextBySequence, truncateForTranslate, cleanupOcrText } = require('#lib/clipboardGuard.js');

test('pickCopiedText: 拿到新文本时返回去空白文本', () => {
  assert.equal(pickCopiedText('old', '  hello world  '), 'hello world');
});

test('pickCopiedText: 剪贴板没变化返回 null', () => {
  assert.equal(pickCopiedText('same text', 'same text'), null);
  assert.equal(pickCopiedText('same text', '  same text  '), null);
});

test('pickCopiedText: 空文本返回 null', () => {
  assert.equal(pickCopiedText('', ''), null);
  assert.equal(pickCopiedText('old', '   '), null);
  assert.equal(pickCopiedText('old', undefined), null);
});

test('pickCopiedText: before 为空（剪贴板原本没有文本）也能拿到新文本', () => {
  assert.equal(pickCopiedText('', 'new stuff'), 'new stuff');
});

test('shouldTranslate: 与上次相同不重复翻译', () => {
  assert.equal(shouldTranslate('hello', 'hello'), false);
  assert.equal(shouldTranslate('  hello  ', 'hello'), false);
  assert.equal(shouldTranslate('hello2', 'hello'), true);
});

test('shouldTranslate: 空文本忽略', () => {
  assert.equal(shouldTranslate('', null), false);
  assert.equal(shouldTranslate('   ', null), false);
  assert.equal(shouldTranslate(null, null), false);
});

test('truncateForTranslate: 不超限原样返回', () => {
  const r = truncateForTranslate('abc', 10);
  assert.deepEqual(r, { text: 'abc', truncated: false });
});

test('truncateForTranslate: 超限截断并标记', () => {
  const r = truncateForTranslate('x'.repeat(50), 10);
  assert.equal(r.text.length, 10);
  assert.equal(r.truncated, true);
});

test('pickCopiedTextBySequence: 序列号变了即使文本相同也算新复制', () => {
  assert.equal(pickCopiedTextBySequence('same', 'same', true), 'same');
});

test('pickCopiedTextBySequence: 序列号没变=没有复制，返回 null', () => {
  assert.equal(pickCopiedTextBySequence('old', 'new text', false), null);
});

test('pickCopiedTextBySequence: 变了但内容为空返回 null', () => {
  assert.equal(pickCopiedTextBySequence('old', '   ', true), null);
  assert.equal(pickCopiedTextBySequence('old', undefined, true), null);
});

test('pickCopiedTextBySequence: 正常取到新文本', () => {
  assert.equal(pickCopiedTextBySequence('old', '  new  ', true), 'new');
});

test('cleanupOcrText: 去掉中文字符之间的空格，保留中英间空格', () => {
  assert.equal(cleanupOcrText('划 词 翻 译 测 试'), '划词翻译测试');
  assert.equal(cleanupOcrText('Hello World 划 词 翻 译'), 'Hello World 划词翻译');
});

test('cleanupOcrText: 保留英文单词间空格与换行结构', () => {
  assert.equal(cleanupOcrText('Hello World 123'), 'Hello World 123');
  assert.equal(cleanupOcrText('第一行\n\n\n第二行'), '第一行\n\n第二行');
});

test('cleanupOcrText: 非字符串与空白安全', () => {
  assert.equal(cleanupOcrText(undefined), '');
  assert.equal(cleanupOcrText('   \n  '), '');
});
