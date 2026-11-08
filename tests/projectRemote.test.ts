import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGitRemote } from '../projectRemote.js';

test('normaliza remotos Git equivalentes a una misma clave', () => {
  const expected = 'github.com/owner/repo';
  for (const remote of [
    'git@github.com:Owner/Repo.git',
    'https://github.com/owner/repo.git',
    'https://user:token@github.com/owner/repo.git/',
    'ssh://git@github.com:22/owner/repo',
    'git://github.com/owner/repo.git',
  ]) {
    assert.equal(normalizeGitRemote(remote), expected, remote);
  }
});

test('descarta remotos locales y valores vacíos', () => {
  assert.equal(normalizeGitRemote('file:///tmp/repo.git'), null);
  assert.equal(normalizeGitRemote('C:/repos/repo.git'), null);
  assert.equal(normalizeGitRemote(''), null);
});
