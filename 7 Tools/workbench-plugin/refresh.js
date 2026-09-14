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
  let source;
  try { source = JSON.parse(await fs.promises.readFile(path.join(root, '7 Tools/confluence-source.json'), 'utf8')); }
  catch { throw new Error('Confluence source settings are missing. Open Tools and setup.'); }
  let sourceUrl;
  try { sourceUrl = new URL(source.siteUrl); }
  catch { throw new Error('The Confluence site URL is invalid. Open Tools and correct it.'); }
  const configuredMode=source.apiMode||'auto';
  const apiMode=configuredMode==='auto'
    ? (/^[-a-z0-9]+\.atlassian\.net$/i.test(sourceUrl.hostname)?'cloud':'server')
    : configuredMode;
  if(!['cloud','server'].includes(apiMode))throw new Error('The Confluence deployment setting is invalid.');
  for (const field of ['secretHelper', 'keychainService', 'keychainAccount']) {
    if (typeof config[field] !== 'string' || !config[field]) throw new Error('Local Confluence settings are incomplete.');
  }
  if(apiMode==='cloud'&&(typeof config.email!=='string'||!config.email))throw new Error('An email address is required for Confluence Cloud.');
  running = true; globalThis.rewbImportRunning = true;
  const notice = Notice ? new Notice('Checking Confluence sources…', 0) : null;
  try {
    const result = await new Promise((resolve, reject) => {
      execFile('/bin/bash', [config.secretHelper, 'REWB-CONFLUENCE-API-TOKEN', 'REWB_TOKEN', '--',
        path.join(root, '7 Tools/.confluence-runtime/bin/python'), path.join(root, '7 Tools/update-confluence.py')],
      {cwd:root, timeout:600000, maxBuffer:1024*1024, env:{...process.env,
        PATH:[path.join(os.homedir(),'.local/bin'),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin','/usr/sbin','/sbin'].join(':'),
        REWB_EMAIL:config.email||'', BWS_KEYCHAIN_SERVICE:config.keychainService, BWS_KEYCHAIN_ACCOUNT:config.keychainAccount}},
      (error, stdout, stderr) => {
        // Whitelist diagnostics: never surface arbitrary helper output or secrets.
        if (error) {
          const conflict = stderr.match(/Refresh stopped: (Local source was edited|Source was edited during refresh|Manifest changed during refresh|Source version changed during refresh|Source changed during refresh|Hierarchy changed during refresh)/);
          const connection = stderr.match(/(Confluence authentication failed\. Check the API token or personal access token|Confluence denied read access\. Check the account and space permissions|Confluence rate limit remained active after retries|Confluence remained temporarily unavailable after retries|Confluence request failed after retries: (?:timeout|connection error)|Confluence request failed with HTTP \d+)/);
          reject(new Error(conflict ? conflict[1]+'. Resolve this before retrying.' : connection ? connection[1]+'.' : 'Refresh failed. Check the connection and local credential setup. The previous imported content may still be shown.'));
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
