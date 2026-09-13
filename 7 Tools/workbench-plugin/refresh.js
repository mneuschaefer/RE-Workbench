// Explicit, local-only launcher for the existing GET-only Confluence adapter.
const fs = require('fs');
const path = require('path');
const os = require('os');
const {execFile} = require('child_process');
let running = false;
module.exports = async function refresh(app, Notice) {
  if (running || globalThis.rewbImportRunning) throw new Error('A source refresh is already running.');
  const root = app.vault.adapter.basePath;
  if (!root) throw new Error('Source refresh requires desktop Obsidian.');
  let config;
  try { config = JSON.parse(await fs.promises.readFile(path.join(root, '7 Tools/.local/confluence.json'), 'utf8')); }
  catch { throw new Error('Local Confluence settings are missing. Open Tools and setup.'); }
  for (const field of ['email', 'secretHelper', 'keychainService', 'keychainAccount']) {
    if (typeof config[field] !== 'string' || !config[field]) throw new Error('Local Confluence settings are incomplete.');
  }
  running = true; globalThis.rewbImportRunning = true;
  const notice = Notice ? new Notice('Checking Confluence sources…', 0) : null;
  try {
    const result = await new Promise((resolve, reject) => {
      execFile('/bin/bash', [config.secretHelper, 'REWB-CONFLUENCE-API-TOKEN', 'REWB_TOKEN', '--',
        path.join(root, '7 Tools/.confluence-runtime/bin/python'), path.join(root, '7 Tools/update-confluence.py')],
      {cwd:root, timeout:240000, maxBuffer:1024*1024, env:{...process.env,
        PATH:[path.join(os.homedir(),'.local/bin'),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin','/usr/sbin','/sbin'].join(':'),
        REWB_EMAIL:config.email, BWS_KEYCHAIN_SERVICE:config.keychainService, BWS_KEYCHAIN_ACCOUNT:config.keychainAccount}},
      (error, stdout, stderr) => {
        // Whitelist diagnostics: never surface arbitrary helper output or secrets.
        if (error) {
          const safe = stderr.match(/Refresh stopped: (Local source was edited|Source was edited during refresh|Manifest changed during refresh|Source version changed during refresh|Source changed during refresh|Hierarchy changed during refresh)/);
          reject(new Error(safe ? safe[1]+'. Resolve this before retrying.' : 'Refresh failed. Check the connection and local credential setup. The previous imported content may still be shown.'));
          return;
        }
        try {
          const data=JSON.parse(stdout.trim());
          if (!Number.isInteger(data.checked) || !Number.isInteger(data.updated)) throw new Error();
          resolve(data);
        } catch { reject(new Error('The importer returned an unexpected result. Check the import log.')); }
      });
    });
    return result;
  } finally { running=false; globalThis.rewbImportRunning=false; notice?.hide(); }
};
