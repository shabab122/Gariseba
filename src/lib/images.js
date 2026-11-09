'use strict';
// Check file signatures, cap pixel count, and re-encode without EXIF or GPS metadata.
const net = require('net');
const sharp = require('sharp');
const config = require('../config');

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null; // HEIC etc. are not accepted server-side; the browser converts to JPEG before upload
}

// Optional ClamAV INSTREAM scan. Returns 'clean' | 'infected' | 'skipped' | 'error'.
function clamScan(buf) {
  if (!config.clam.host) return Promise.resolve('skipped');
  return new Promise((resolve) => {
    const sock = net.connect(config.clam.port, config.clam.host);
    let out = '';
    sock.setTimeout(8000, () => { sock.destroy(); resolve('error'); });
    sock.on('error', () => { sock.destroy(); resolve('error'); });
    sock.on('data', (d) => (out += d.toString()));
    sock.on('close', () => resolve(/FOUND/.test(out) ? 'infected' : /OK/.test(out) ? 'clean' : 'error'));
    sock.write('zINSTREAM\0');
    for (let i = 0; i < buf.length; i += 65536) {
      const chunk = buf.subarray(i, i + 65536);
      const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
      sock.write(len); sock.write(chunk);
    }
    sock.write(Buffer.alloc(4));
  });
}

async function processPhoto(buf) {
  const mime = sniff(buf);
  if (!mime) throw Object.assign(new Error('type'), { code: 'bad_type' });
  const scan = await clamScan(buf);
  if (scan === 'infected') throw Object.assign(new Error('infected'), { code: 'infected' });
  if (scan === 'error') throw Object.assign(new Error('scan'), { code: 'scan_error' });
  let out;
  try {
    out = await sharp(buf, { limitInputPixels: 40e6, failOn: 'error' })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 77, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    throw Object.assign(new Error('decode'), { code: 'bad_image' });
  }
  if (out.length > config.limits.storedPhotoMaxBytes) {
    throw Object.assign(new Error('Image remains too large after compression.'), { code: 'too_large' });
  }
  return { content: out, mime: 'image/jpeg', bytes: out.length, scan };
}

module.exports = { processPhoto, sniff };
