import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeRel, sanitizeName, toAbs, uniqueName, validateName, isWithinRel } from '../server/paths.ts';
import { tempDir } from './helpers.ts';

test('normalizeRel collapses slashes and rejects traversal', () => {
  assert.equal(normalizeRel(''), '/');
  assert.equal(normalizeRel('a//b\\c/'), '/a/b/c');
  assert.equal(normalizeRel('/./a/./b'), '/a/b');
  assert.throws(() => normalizeRel('../x'), /escapes/);
  assert.throws(() => normalizeRel('a/../../x'), /escapes/);
  assert.throws(() => normalizeRel('a\\..\\x'), /escapes/);
  assert.throws(() => normalizeRel('/.homenas/homenas.db'), /reserved/);
  assert.throws(() => normalizeRel('/file.txt:secret'), /not allowed/); // NTFS alternate data stream
});

test('sanitizeName makes any name safe on Windows', () => {
  assert.equal(sanitizeName('IMG_0001.HEIC'), 'IMG_0001.HEIC');
  assert.equal(sanitizeName('a<b>c:d"e|f?g*h'), 'a_b_c_d_e_f_g_h');
  assert.equal(sanitizeName('CON'), '_CON');
  assert.equal(sanitizeName('nul.txt'), '_nul.txt');
  assert.equal(sanitizeName('trailing dots...'), 'trailing dots');
  assert.equal(sanitizeName('..'), 'file');
  assert.equal(sanitizeName('.homenas'), '_homenas');
  // iOS sends decomposed Unicode (NFD); store composed (NFC) so names compare equal.
  assert.equal(sanitizeName('Café.jpg'), 'Café.jpg');
  const long = 'x'.repeat(300) + '.jpg';
  const out = sanitizeName(long);
  assert.ok(Buffer.byteLength(out) <= 200 && out.endsWith('.jpg'));
});

test('validateName explains what is wrong instead of silently changing it', () => {
  assert.equal(validateName('  Holiday 2026 '), 'Holiday 2026');
  assert.throws(() => validateName('a/b'), /cannot contain/);
  assert.throws(() => validateName('name.'), /end with a dot/);
  assert.throws(() => validateName('LPT1'), /reserved/);
  assert.throws(() => validateName(''), /empty/);
});

test('toAbs cannot escape the space root, including through a junction', () => {
  const dir = tempDir('paths');
  const root = path.join(dir, 'space');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  assert.equal(toAbs(root, '/a/b'), path.join(root, 'a', 'b'));
  // A name that merely starts with two dots is inside the root, both before and after it exists on disk.
  assert.equal(toAbs(root, '/..notes'), path.join(root, '..notes'));
  fs.mkdirSync(path.join(root, '..notes'));
  assert.equal(toAbs(root, '/..notes/a.txt'), path.join(root, '..notes', 'a.txt'));
  fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
  assert.throws(() => toAbs(root, '/link/secret.txt'), /escapes/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('uniqueName appends (n) and respects case-insensitive filesystems', () => {
  const dir = tempDir('unique');
  fs.writeFileSync(path.join(dir, 'Photo.jpg'), '');
  fs.writeFileSync(path.join(dir, 'Photo (1).jpg'), '');
  assert.equal(uniqueName(dir, 'new.jpg'), 'new.jpg');
  assert.equal(uniqueName(dir, 'Photo.jpg'), 'Photo (2).jpg');
  if (process.platform === 'win32') assert.equal(uniqueName(dir, 'PHOTO.JPG'), 'PHOTO (2).JPG');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isWithinRel', () => {
  assert.ok(isWithinRel('/a/b', '/a'));
  assert.ok(isWithinRel('/a', '/a'));
  assert.ok(!isWithinRel('/ab', '/a'));
  assert.ok(isWithinRel('/A/b', '/a'));
});
