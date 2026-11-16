const fs = require('fs');
const zlib = require('zlib');

const raw = fs.readFileSync('d:/Zeblaze/scratch/btsnoop_hr.txt', 'utf8');
const b64 = raw
  .replace(/--- BEGIN[^\n]*\n/, '')
  .replace(/--- END[^\n]*/, '')
  .replace(/\s+/g, '');
const buf = Buffer.from(b64, 'base64');
let zlibBuf = buf;
const idx = buf.indexOf(Buffer.from([0x78, 0x9c]));
if (idx !== -1) zlibBuf = buf.slice(idx);
const decomp = zlib.inflateSync(zlibBuf);

const attPackets = [];
for (let i = 2; i < decomp.length - 8; i++) {
  if (decomp[i] === 0x04 && decomp[i + 1] === 0x00) {
    const l2capLen = decomp.readUInt16LE(i - 2);
    const opcode = decomp[i + 2];
    if ([0x52, 0x12, 0x1b, 0x1d, 0x08, 0x09, 0x0a, 0x0b].includes(opcode)) {
      if (
        l2capLen >= 3 &&
        l2capLen <= 250 &&
        i + 2 + l2capLen <= decomp.length
      ) {
        const handle = decomp.readUInt16LE(i + 3);
        const payload = decomp.slice(i + 5, i + 2 + l2capLen);
        const opName =
          opcode === 0x52
            ? 'WRITE_CMD'
            : opcode === 0x1b
            ? 'NOTIFY'
            : opcode === 0x12
            ? 'WRITE_REQ'
            : 'OP_' + opcode.toString(16);
        attPackets.push({
          pos: i,
          opName,
          handle: '0x' + handle.toString(16).padStart(4, '0'),
          len: payload.length,
          hex: payload.toString('hex'),
        });
      }
    }
  }
}

console.log('Total ATT packets:', attPackets.length);
console.log('--- LAST 40 ATT PACKETS ---');
attPackets.slice(-40).forEach((p, index) => {
  console.log(
    `#${String(index).padStart(3, '0')} ${p.opName} h=${p.handle} (len=${p.len}): ${p.hex}`
  );
});
