const fs = require('fs');
const xml = fs.readFileSync('scratch/app_connected_now.xml', 'utf8');
const lines = xml.split('><');
for (const l of lines) {
  if (l.includes('❤️ HR') || l.includes('SpO2') || l.includes('Sync')) {
    console.log(l);
  }
}
