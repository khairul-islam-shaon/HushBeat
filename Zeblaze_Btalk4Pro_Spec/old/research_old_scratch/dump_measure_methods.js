const fs = require('fs');
const buf = fs.readFileSync('scratch/zc_dex/classes.dex');

const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsSize = buf.readUInt32LE(0x40);
const typeIdsOff = buf.readUInt32LE(0x44);
const methodIdsSize = buf.readUInt32LE(0x58);
const methodIdsOff = buf.readUInt32LE(0x5c);

function getString(idx) {
  if (idx < 0 || idx >= stringIdsSize) return '';
  const off = buf.readUInt32LE(stringIdsOff + idx * 4);
  let p = off; while (buf[p] & 0x80) p++; p++;
  let end = p; while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}
function getType(idx) { return getString(buf.readUInt32LE(typeIdsOff + idx * 4)); }
function getMethod(idx) {
  if (idx < 0 || idx >= methodIdsSize) return '';
  const classIdx = buf.readUInt16LE(methodIdsOff + idx * 8);
  const nameIdx = buf.readUInt32LE(methodIdsOff + idx * 8 + 4);
  return `${getType(classIdx)}->${getString(nameIdx)}`;
}

function dumpCode(codeOff) {
  const regs = buf.readUInt16LE(codeOff);
  const ins = buf.readUInt16LE(codeOff + 2);
  const outs = buf.readUInt16LE(codeOff + 4);
  const insnsSize = buf.readUInt32LE(codeOff + 12);
  console.log(`Regs: ${regs}, Ins: ${ins}, Outs: ${outs}, Size: ${insnsSize}`);
  const insns = buf.subarray(codeOff + 16, codeOff + 16 + insnsSize * 2);
  for (let ip = 0; ip < insnsSize * 2; ip += 2) {
    const op = insns[ip];
    let extra = '';
    if (op === 0x1a) extra = `str="${getString(insns.readUInt16LE(ip + 2))}"`;
    if (op >= 0x6e && op <= 0x72) extra = `meth=${getMethod(insns.readUInt16LE(ip + 2))}`;
    console.log(`  [${(ip/2).toString(16)}] op=0x${op.toString(16)} hex=${insns.slice(ip, ip+4).toString('hex')} ${extra}`);
  }
}

console.log('--- Method s (4184556) ---');
dumpCode(4184556);
console.log('--- Method i (4184688) ---');
dumpCode(4184688);
console.log('--- Method t (4184644) ---');
dumpCode(4184644);
