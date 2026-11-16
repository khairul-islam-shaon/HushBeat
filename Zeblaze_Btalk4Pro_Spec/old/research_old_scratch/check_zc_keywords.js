const fs = require('fs');

['classes.dex', 'classes2.dex'].forEach(file => {
  const buf = fs.readFileSync(`d:/Zeblaze/scratch/zc_dex/${file}`);
  console.log(`=== ${file} (${buf.length} bytes) ===`);
  const keywords = ['crrepa', 'Btalk', 'FD:99', '000001ff', 'ff02', 'ff03', 'BleManager', 'BluetoothGatt', 'HeartRate', 'Oxygen', 'Step', 'blood_oxygen'];
  keywords.forEach(kw => {
    let count = 0;
    let idx = 0;
    while ((idx = buf.indexOf(kw, idx)) !== -1) {
      count++;
      idx += kw.length;
    }
    console.log(`  "${kw}": ${count}`);
  });
});
