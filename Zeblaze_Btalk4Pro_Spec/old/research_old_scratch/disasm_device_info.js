const fs = require('fs');
const buf = fs.readFileSync('scratch/zc_dex/classes.dex');
const codeOff = 4220344;
const insnsSize = buf.readUInt32LE(codeOff + 12);
const insns = buf.slice(codeOff + 16, codeOff + 16 + insnsSize * 2);

const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
function getString(idx) {
  if (idx < 0 || idx >= stringIdsSize) return '';
  const off = buf.readUInt32LE(stringIdsOff + idx * 4);
  let p = off; while (buf[p] & 0x80) p++; p++;
  let end = p; while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}

for (let ip = 0; ip < insns.length; ip += 2) {
  const op = insns[ip];
  let extra = '';
  if (op === 0x1a) {
    extra = `str="${getString(insns.readUInt16LE(ip + 2))}"`;
  }
  if (op === 0x13) {
    extra = `lit=${insns.readInt16LE(ip + 2)}`;
  }
  if (op === 0x2b) {
    extra = `packed-switch`;
  }
  if (op === 0x2c) {
    extra = `sparse-switch`;
  }
  console.log(`[${(ip/2).toString(16).padStart(3, '0')}] op=0x${op.toString(16)} b1=0x${insns[ip+1].toString(16)} ${extra}`);
}
