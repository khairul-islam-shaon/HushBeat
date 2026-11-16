const fs = require('fs');
const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');
const codeOff = 4244360;
const insnsSize = buf.readUInt32LE(codeOff + 12);
const insns = buf.slice(codeOff + 16, codeOff + 16 + insnsSize * 2);

console.log('ByteDataConvertUtil::f insns count:', insnsSize);
let ip = 0;
while (ip < insns.length) {
  const pc = ip / 2;
  const op = insns[ip];
  console.log('[' + pc.toString(16).padStart(3, '0') + '] op=' + op.toString(16) + ' hex=' + insns.slice(ip, ip + 4).toString('hex'));
  ip += 2;
}
