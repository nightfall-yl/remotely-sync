const fs = require('fs');
const content = fs.readFileSync('main.js', 'utf8');

// Alternative: grep for specific library patterns and count their occurrences
// Then manually estimate based on typical library sizes

console.log('=== Bundle Size Analysis ===\n');

// Count occurrences of library identifiers
const libs = {
  'AWS SDK': ['S3Client', 'HeadObjectCommand', 'PutObjectCommand', 'GetObjectCommand', 'ListObjectsV2Command', 'DeleteObjectCommand', 'CopyObjectCommand', 'CreateMultipartUploadCommand', 'UploadPartCommand', 'CompleteMultipartUploadCommand', 'AbortMultipartUploadCommand'],
  'AWS Signature': ['SignatureV4', 'signature-v4-crt', 'aws-crt', 'Sha256'],
  'WebDAV': ['WebDAVClient', 'createClient', 'PROPFIND', 'MKCOL', 'COPY', 'MOVE'],
  'OneDrive': ['OneDrive', 'onedrive', 'graph.microsoft.com'],
  'Dropbox': ['Dropbox', 'dropbox.com'],
  'MIME': ['mimeTypes', 'mime-db', 'contentType'],
  'Archiver': ['archiver', 'Zip'],
  'Crypto': ['SubtleCrypto', 'crypto.subtle', 'AES-GCM', 'PBKDF2'],
  'Pako': ['pako', 'inflate', 'deflate'],
  'Luxon': ['DateTime', 'Interval', 'Duration', 'luxon'],
};

for (const [lib, patterns] of Object.entries(libs)) {
  let maxCount = 0;
  for (const p of patterns) {
    const count = (content.match(new RegExp(p, 'gi')) || []).length;
    maxCount = Math.max(maxCount, count);
  }
  console.log(`${lib}: detected (${maxCount} occurrences)`);
}

// Check if aws-sdk v2 is bundled (larger than v3)
const awsV2Count = (content.match(/AWS\.S3|require\(['"]aws-sdk['"]\)/g) || []).length;
const awsV3Count = (content.match(/@aws-sdk/g) || []).length;
console.log(`\n--- AWS SDK Version ---`);
console.log(`AWS SDK v2 (legacy): ${awsV2Count} occurrences`);
console.log(`AWS SDK v3 (modular): ${awsV3Count} occurrences`);

// Check bundle for debug symbols
const debugSymbols = ['console.log', 'console.debug', 'console.warn'];
console.log(`\n--- Debug Symbols ---`);
for (const sym of debugSymbols) {
  const count = (content.match(new RegExp(sym, 'g')) || []).length;
  console.log(`${sym}: ${count} occurrences`);
}
