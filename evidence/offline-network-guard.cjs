// Verification harness only. The runtime's own --offline disables downloads.
// This harness additionally makes any HTTP/fetch attempt fail, and counts it.
const fs = require('node:fs');
let attempts = 0;
function deny() { attempts++; throw new Error('Network forbidden by offline verification harness'); }
globalThis.fetch = deny;
for (const name of ['node:http', 'node:https']) {
  const mod = require(name);
  mod.request = deny;
  mod.get = deny;
}
process.on('exit', () => {
  fs.writeFileSync('evidence/offline-network-count.json', `${JSON.stringify({ attemptedRequests: attempts, policy: 'HTTP and fetch throw on use' }, null, 2)}\n`);
});
