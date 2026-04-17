const fs = require('fs');
const content = fs.readFileSync('main.js', 'utf8');

// Check for specific AWS SDK modules
const awsModules = [
  'client-s3', 'signature-v4', 'signature-v4-crt', 'middleware-stack',
  'middleware-retry', 'middleware-logger', 'credential-providers',
  'region-config', 'config-resolver', 'endpoint-cache', 's3-request-presigner'
];

console.log('AWS SDK v3 module presence:');
for (const mod of awsModules) {
  const pattern = `@aws-sdk/${mod}`;
  const count = content.split(pattern).length - 1;
  if (count > 0) console.log(`  ${pattern}: ${count}`);
}

// Check for aws-crt (native module)
const crtModules = ['aws-crt', 'crc32', 'event-stream', 'io', 'auth', 'http'];
console.log('\nAWS CRT (native) presence:');
for (const mod of crtModules) {
  const count = content.split(`aws-crt/${mod}`).length - 1 + content.split(`"aws-crt"/"${mod}"`).length - 1;
  if (count > 0) console.log(`  aws-crt/${mod}: ${count}`);
}

// Rough size estimation by counting characters between markers
console.log('\n--- Size estimation by library ---');

// Count approximate bytes for each major library
const libs = [
  { name: 'AWS SDK v3', patterns: ['@aws-sdk/', 'aws-sdk/'] },
  { name: 'AWS CRT', patterns: ['aws-crt'] },
  { name: 'WebDAV', patterns: ['webdav'] },
  { name: 'MIME types', patterns: ['mime-db', 'mime-types'] },
  { name: 'UUID', patterns: ['uuid', 'crypto-'] },
];

for (const lib of libs) {
  let total = 0;
  for (const p of lib.patterns) {
    const parts = content.split(p);
    // Rough estimate: each occurrence adds ~500 bytes on average
    total += (parts.length - 1) * 500;
  }
  console.log(`  ${lib.name}: ~${(total / 1024).toFixed(1)} KB estimated`);
}

console.log(`\nTotal bundle size: ${(content.length / 1024 / 1024).toFixed(2)} MB`);
