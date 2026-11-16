const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

const codeOff = 4236691;
const insns = buf.slice(codeOff - 32, codeOff + 80);

for (let ip = 0; ip < insns.length; ip += 2) {
  const pc = ip / 2;
  console.log(`[${pc.toString(16).padStart(3, '0')}] op=${insns[ip].toString(16)} hex=${insns.slice(ip, ip + 4).toString('hex')}`);
}
