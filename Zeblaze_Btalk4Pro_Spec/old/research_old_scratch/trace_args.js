const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

const codeOff = 4224732;
const codeStart = codeOff + 16;
const insns = buf.slice(codeStart, codeStart + 1172 * 2);

// In invoke-range or invoke-kind (0x6e, 0x71, 0x74):
// 71 30 [mId] [args] -> 71 (invoke-static), 3 args:
// vC, vD, vE (or packed in 16-bit word)
// In Dalvik: 71 [count/reg] [mId 2B] [regs 2B]
// e.g. 71 30 [mId] [D C] [F E] -> args are vC, vD, vE

function inspectInvoke(pc) {
  const ip = pc * 2;
  const op = insns[ip];
  const count = insns[ip + 1] >> 4;
  const mId = insns.readUInt16LE(ip + 2);
  const regs = [];
  if (op === 0x71 || op === 0x6e) {
    const regWord1 = insns.readUInt16LE(ip + 4);
    regs.push(regWord1 & 0x0f);
    if (count > 1) regs.push((regWord1 >> 4) & 0x0f);
    if (count > 2) regs.push((regWord1 >> 8) & 0x0f);
    if (count > 3) regs.push((regWord1 >> 12) & 0x0f);
  }
  return { pc: pc.toString(16), count, mId, regs };
}

console.log('--- Real-time steps invokes ---');
console.log('pc 0x435:', inspectInvoke(0x435));
console.log('pc 0x439:', inspectInvoke(0x439));
console.log('pc 0x43f:', inspectInvoke(0x43f));

console.log('--- Single measure header invokes ---');
console.log('pc 0x1b6:', inspectInvoke(0x1b6));
console.log('pc 0x1ba:', inspectInvoke(0x1ba));
console.log('pc 0x1d0:', inspectInvoke(0x1d0));

// Also let's print Dalvik instructions preceding these calls to see what constant ints were loaded into those arg regs!
function printPreceding(startPc, endPc) {
  for (let p = startPc; p <= endPc; p++) {
    const ip = p * 2;
    console.log(`[${p.toString(16)}] op=${insns[ip].toString(16)} raw=${insns.slice(ip, ip + 4).toString('hex')}`);
  }
}

console.log('\n--- Preceding 0x435 (real time steps) ---');
printPreceding(0x430, 0x442);

console.log('\n--- Preceding 0x1b6 (single measure) ---');
printPreceding(0x1b0, 0x1c2);
