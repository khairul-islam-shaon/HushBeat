const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

const codeOff = 4224732;
const codeStart = codeOff + 16;
const insns = buf.slice(codeStart, codeStart + 1172 * 2);

// Look at pc 0x1b4 to 0x1c4 in DeviceReportEventParser
// In Dalvik:
// v14 is the input byte[] packet!
// Let's trace how v5 (type), v13 (status), and values are extracted from v14!

for (let p = 0x1b0; p <= 0x1c4; p++) {
  const ip = p * 2;
  const op = insns[ip];
  const b1 = insns[ip + 1];
  const w1 = insns.readUInt16LE(ip + 2);
  console.log(`pc [${p.toString(16)}]: op=${op.toString(16)} b1=${b1.toString(16)} w1=${w1.toString(16)} (hex: ${insns.slice(ip, ip + 6).toString('hex')})`);
}
