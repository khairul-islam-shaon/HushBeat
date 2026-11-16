const fs = require('fs');
const xml = fs.readFileSync('scratch/app_hr_done.xml', 'utf8');
const lines = xml.split('><');
for (const l of lines) {
  if (l.includes('Stop Heart Rate')) {
    console.log(l);
  }
}
