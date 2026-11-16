const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

const codeOff = 4224732;
const codeStart = codeOff + 16;
const insns = buf.slice(codeStart, codeStart + 1172 * 2);

// Let's decode bytes between pc 0x01af and 0x01c5
// In Dalvik bytecode:
// pc is 16-bit word index
for (let pc = 0x01af; pc <= 0x01c5; pc++) {
  const ip = pc * 2;
  const op = insns[ip];
  const b1 = insns[ip + 1];
  const b2 = insns[ip + 2];
  const b3 = insns[ip + 3];
  console.log(`pc [${pc.toString(16).padStart(4, '0')}]: op=0x${op.toString(16)} (raw: ${insns.slice(ip, ip + 4).toString('hex')})`);
}
