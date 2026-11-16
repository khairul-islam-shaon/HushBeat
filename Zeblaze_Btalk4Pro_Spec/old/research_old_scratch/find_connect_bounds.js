const fs = require('fs');
const xml = fs.readFileSync('scratch/app_scanned.xml', 'utf8');
const lines = xml.split('><');
let foundTarget = false;
for (const l of lines) {
  if (l.includes('FD:99:E2:BB:76:D0') || l.includes('★ TARGET')) {
    foundTarget = true;
  }
  if (foundTarget && l.includes('Connect') && l.includes('bounds=')) {
    console.log(l);
    const m = l.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (m) {
      const cx = Math.floor((parseInt(m[1]) + parseInt(m[3])) / 2);
      const cy = Math.floor((parseInt(m[2]) + parseInt(m[4])) / 2);
      console.log('Connect Center:', cx, cy);
      break;
    }
  }
}
