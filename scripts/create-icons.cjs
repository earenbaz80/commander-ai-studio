const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

async function main() {
  const svgPath = path.resolve(__dirname, '../public/app-icon.svg');
  const svg = fs.readFileSync(svgPath, 'utf8');

  // 1. Render 512x512 PNG
  const resvg512 = new Resvg(svg, {
    fitTo: { mode: 'width', value: 512 },
  });
  const png512 = resvg512.render().asPng();

  // 2. Render 256x256 PNG
  const resvg256 = new Resvg(svg, {
    fitTo: { mode: 'width', value: 256 },
  });
  const png256 = resvg256.render().asPng();

  const buildDir = path.resolve(__dirname, '../build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  // Save PNGs
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
  fs.writeFileSync(path.resolve(__dirname, '../public/icon.png'), png512);
  fs.writeFileSync(path.join(buildDir, 'icon-256.png'), png256);

  // 3. Create standard Windows Vista+ 256x256 PNG-encoded ICO
  let icoBuffer;
  try {
    const rawMod = require('png-to-ico');
    const fn = typeof rawMod === 'function' ? rawMod : rawMod.default;
    if (typeof fn === 'function') {
      icoBuffer = await fn([png256]);
    }
  } catch (e) {
    console.warn('png-to-ico fallback:', e.message);
  }

  if (!icoBuffer) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // Reserved
    header.writeUInt16LE(1, 2); // 1 = ICO
    header.writeUInt16LE(1, 4); // 1 Image Entry

    const entry = Buffer.alloc(16);
    entry.writeUInt8(0, 0); // Width: 0 means 256px
    entry.writeUInt8(0, 1); // Height: 0 means 256px
    entry.writeUInt8(0, 2); // Colors in palette: 0
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes: 1
    entry.writeUInt16LE(32, 6); // Bits per pixel: 32
    entry.writeUInt32LE(png256.length, 8); // Image byte size
    entry.writeUInt32LE(22, 12); // Offset: 6 + 16 = 22

    icoBuffer = Buffer.concat([header, entry, png256]);
  }

  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
  fs.writeFileSync(path.resolve(__dirname, '../public/favicon.ico'), icoBuffer);

  console.log('[SUCCESS] Icons generated successfully:');
  console.log(' - build/icon.ico:', fs.statSync(path.join(buildDir, 'icon.ico')).size, 'bytes');
  console.log(' - build/icon.png:', fs.statSync(path.join(buildDir, 'icon.png')).size, 'bytes');
}

main().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
