const fs = require('fs');
const xml = fs.readFileSync('scratch/app_live_test.xml', 'utf8');
const lines = xml.split('><');
for (const l of lines) {
  if (l.includes('Scan') || l.includes('Discovered')) {
    console.log(l);
  }
}
