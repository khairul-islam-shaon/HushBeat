const fs = require('fs');
const xml = fs.readFileSync('scratch/app_sync_now.xml', 'utf8');
const texts = [...xml.matchAll(/text="([^"]+)"/g)].map(m => m[1]);
console.log(texts);
