const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
test('Keychain adapter passes token only to child and stops on denied or empty credentials', () => {
  for (const mode of ['ok', 'denied', 'empty']) {
    const mock = mode === 'ok' ? 'printf test-token' : mode === 'denied' ? 'printf hidden-diagnostic >&2; return 1' : 'return 0';
    const result = spawnSync('/bin/bash', ['-c', `function /usr/bin/security() { ${mock}; }; source "$1" REWB-CONFLUENCE-API-TOKEN REWB_TOKEN -- "$2" -e 'if(process.env.REWB_TOKEN!=="test-token")process.exit(9)'`, 'test', path.resolve(__dirname, '../keychain-helper.sh'), process.execPath], {
      env: {...process.env, BWS_KEYCHAIN_SERVICE: 'test-service', BWS_KEYCHAIN_ACCOUNT: 'test-account'}, encoding: 'utf8'
    });
    assert.equal(result.status, mode === 'ok' ? 0 : 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('test-token') && !result.stderr.includes('hidden-diagnostic'));
  }
});
