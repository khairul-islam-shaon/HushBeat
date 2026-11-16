const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/btsnoop_decompressed.log');

const attPackets = [];
for (let i = 2; i < buf.length - 8; i++) {
  // CID 0x0004 is ATT
  if (buf[i] === 0x04 && buf[i + 1] === 0x00) {
    const l2capLen = buf.readUInt16LE(i - 2);
    const opcode = buf[i + 2];
    if ([0x52, 0x12, 0x1b, 0x1d, 0x08, 0x09, 0x0a, 0x0b].includes(opcode)) {
      if (l2capLen >= 3 && l2capLen <= 250 && i + 2 + l2capLen <= buf.length) {
        const handle = buf.readUInt16LE(i + 3);
        const payload = buf.slice(i + 5, i + 2 + l2capLen);
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

console.log('Total ATT packets found:', attPackets.length);
console.log('--- ALL ATT PACKETS ---');
attPackets.forEach((p, idx) => {
  console.log(
    `#${String(idx).padStart(3, '0')} ${p.opName} h=${p.handle} (len=${p.len}): ${p.hex}`
  );
});
