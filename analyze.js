const fs = require('fs');
const content = fs.readFileSync('main.js', 'utf8');

// Find module paths in webpack bundle
const modulePattern = /\*\*\/\s*"(.+?)"/g;
const modules = new Map();

let match;
while ((match = modulePattern.exec(content)) !== null) {
  const path = match[1];
  if (path.startsWith('.')) continue; // skip relative paths
  modules.set(path, true);
}

console.log('External modules found in bundle:');
const sorted = [...modules.keys()].sort();
for (const m of sorted.slice(0, 50)) {
  console.log('  ' + m);
}
console.log('\nTotal external modules:', modules.size);

// Check for large libraries
const libs = ['@aws-sdk', 'aws-sdk', 'dropbox', 'webdav', 'mime', 'lodash', 'pako', 'luxon', 'uuid'];
console.log('\nLibrary presence check:');
for (const lib of libs) {
  const count = content.split(lib).length - 1;
  console.log(`  ${lib}: ${count} occurrences`);
}
