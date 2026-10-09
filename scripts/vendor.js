// Copies the prebuilt Mermaid bundle into the renderer so the packaged app
// ships one file instead of Mermaid's whole dependency tree.
const fs = require('fs');
const path = require('path');

const src = require.resolve('mermaid/dist/mermaid.min.js');
const destDir = path.join(__dirname, '..', 'src', 'renderer', 'vendor');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'mermaid.min.js'));
console.log('vendored mermaid', require('mermaid/package.json').version);
