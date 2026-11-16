const fs = require('fs');
const xml = fs.readFileSync('scratch/app_live_test.xml', 'utf8');
const m = xml.match(/text="[^"]*Scan[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
if (m) {
  console.log('Scan bounds:', m[1], m[2], m[3], m[4]);
  const cx = Math.floor((parseInt(m[1]) + parseInt(m[3])) / 2);
  const cy = Math.floor((parseInt(m[2]) + parseInt(m[4])) / 2);
  console.log('Center:', cx, cy);
}
