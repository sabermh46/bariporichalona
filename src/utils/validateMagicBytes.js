const fs = require('fs');
const path = require('path');

// First-byte signatures for allowed file types
const SIGNATURES = {
  jpg:  [0xFF, 0xD8, 0xFF],
  jpeg: [0xFF, 0xD8, 0xFF],
  png:  [0x89, 0x50, 0x4E, 0x47],
  gif:  [0x47, 0x49, 0x46, 0x38],
  pdf:  [0x25, 0x50, 0x44, 0x46],
};

function validateMagicBytes(filePath, originalName) {
  const ext = path.extname(originalName).replace('.', '').toLowerCase();
  const sig = SIGNATURES[ext];
  if (!sig) return false;

  const buffer = Buffer.alloc(sig.length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, sig.length, 0);
  } finally {
    fs.closeSync(fd);
  }

  return sig.every((byte, i) => buffer[i] === byte);
}

module.exports = { validateMagicBytes };
