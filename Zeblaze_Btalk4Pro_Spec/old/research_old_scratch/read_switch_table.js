const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

const codeOff = 4224732;
const codeStart = codeOff + 16;
const insns = buf.slice(codeStart, codeStart + 1172 * 2);

const tablePos = 0x0482 * 2;
const ident = insns.readUInt16LE(tablePos);
const size = insns.readUInt16LE(tablePos + 2);
const firstKey = insns.readInt32LE(tablePos + 4);

console.log(`Table ident: 0x${ident.toString(16)}, size: ${size}, firstKey: ${firstKey}`);

for (let i = 0; i < size; i++) {
  const targetOffset = insns.readInt32LE(tablePos + 8 + i * 4);
  const targetPc = 0x01c2 + targetOffset;
  console.log(`Key ${firstKey + i} -> targetOffset: 0x${targetOffset.toString(16)} (pc: 0x${targetPc.toString(16)})`);
}
