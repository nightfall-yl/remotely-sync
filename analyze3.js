const fs = require('fs');
const content = fs.readFileSync('main.js', 'utf8');

// More accurate approach: look for class/function definitions and module boundaries
// Webpack bundles have comments like /***/ "./node_modules/..." /***/

const lines = content.split('\n');
let inModule = false;
let currentModule = '';
let moduleSizes = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Check for webpack module markers
  const moduleMatch = line.match(/\/\*\*\*\/ "?\.\/node_modules\/([^"\/]+)/);
  if (moduleMatch) {
    const lib = moduleMatch[1];
    if (!moduleSizes[lib]) moduleSizes[lib] = 0;
    // Count lines until next module marker
    let count = 0;
    for (let j = i; j < lines.length && !lines[j+1]?.match(/\/\*\*\*"/); j++) {
      count += lines[j].length;
    }
    moduleSizes[lib] += count;
  }
}

// Sort by size
const sorted = Object.entries(moduleSizes)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

console.log('Top 20 largest node_modules in bundle:');
for (const [lib, size] of sorted) {
  console.log(`  ${lib}: ${(size / 1024).toFixed(1)} KB`);
}
