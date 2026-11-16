const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

const codeOff = 4224732;
const codeStart = codeOff + 16;
const insns = buf.slice(codeStart, codeStart + 1172 * 2);

// Let's decode Dalvik bytecode precisely
// opcode table for common opcodes
function getReg(val, shift, mask) {
  return (val >> shift) & mask;
}

for (let pc = 0x430; pc <= 0x465; pc++) {
  const ip = pc * 2;
  const op = insns[ip];
  const b1 = insns[ip + 1];
  const w1 = insns.readUInt16LE(ip + 2);
  const w2 = ip + 4 < insns.length ? insns.readUInt16LE(ip + 4) : 0;
  console.log(`[${pc.toString(16).padStart(4, '0')}] op=0x${op.toString(16).padStart(2, '0')} b1=0x${b1.toString(16)} w1=0x${w1.toString(16)} w2=0x${w2.toString(16)} (hex: ${insns.slice(ip, ip + 6).toString('hex')})`);
}
