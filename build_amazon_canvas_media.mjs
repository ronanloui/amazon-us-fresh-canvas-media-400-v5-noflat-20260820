import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const PROJECT_ROOT = '/Users/leo/Documents/ChatGPT/亚马逊/outputs/amazon_us_fresh_canvas_media_400_v5_noflat_20260820';
const SOURCE_ROOT = '/Users/leo/Documents/ChatGPT/亚马逊/outputs/amazon_us_fresh_flat_art_400_20260820';
const SOURCE_MANIFEST_PATH = path.join(SOURCE_ROOT, 'fresh_generation_manifest.json');
const MEDIA_ROOT = path.join(PROJECT_ROOT, 'media');
const REPOSITORY = 'ronanloui/amazon-us-fresh-canvas-media-400-v5-noflat-20260820';
const RAW_BASE = `https://raw.githubusercontent.com/${REPOSITORY}/main`;
const ROLE_SETS = {
  V23: ['MAIN', 'DETAIL', 'SCENE-LIVING', 'SCENE-DINING', 'SIZE'],
  H32: ['MAIN', 'DETAIL', 'SCENE-LIVING', 'SCENE-BEDROOM', 'SIZE'],
};
const ALL_ROLES = ['MAIN', 'DETAIL', 'SCENE-LIVING', 'SCENE-DINING', 'SCENE-BEDROOM', 'SIZE'];
const TEMPLATE_ASSET_ROOT = path.join(PROJECT_ROOT, 'template_assets');
const TEMPLATE_ASSETS = {
  scenePortraitLiving: path.join(TEMPLATE_ASSET_ROOT, 'scene_portrait_living_empty.png'),
  scenePortraitDining: path.join(TEMPLATE_ASSET_ROOT, 'scene_portrait_dining_empty.png'),
  sceneLandscapeBedroom: path.join(TEMPLATE_ASSET_ROOT, 'scene_landscape_bedroom_empty.png'),
  sceneLandscapeLiving: path.join(TEMPLATE_ASSET_ROOT, 'scene_landscape_living_empty.png'),
};

const THEME_SLUGS = {
  A01: 'modern-organic-abstract',
  A02: 'vintage-botanical-cottagecore',
  A03: 'nature-landscape-vintage-scenery',
  A04: 'coastal-ocean',
  A05: 'vintage-halloween-cute-dark',
  A06: 'bathroom-office-calm',
  A07: 'dorm-youth-vintage-travel',
  A08: 'original-creative-studio',
};

const THEME_PALETTES = {
  A01: { wallA: '#eee9e1', wallB: '#d9d1c6', wood: '#6f452f', accent: '#79806e' },
  A02: { wallA: '#edf0e6', wallB: '#d5dccd', wood: '#76503a', accent: '#7c8867' },
  A03: { wallA: '#e9e5db', wallB: '#ced5d2', wood: '#664733', accent: '#6f7f77' },
  A04: { wallA: '#eaf0f0', wallB: '#cddadd', wood: '#79533d', accent: '#728e95' },
  A05: { wallA: '#e8e0d7', wallB: '#d1c3ba', wood: '#5d3a2c', accent: '#765b4e' },
  A06: { wallA: '#f0ece6', wallB: '#d7d4ce', wood: '#705241', accent: '#7e8b84' },
  A07: { wallA: '#eee9df', wallB: '#d9cdbf', wood: '#75503a', accent: '#8d7963' },
  A08: { wallA: '#ece9e1', wallB: '#d7d1c5', wood: '#684632', accent: '#74877d' },
};

const ORIENTATIONS = {
  V23: {
    label: 'portrait_2x3',
    ratio: '2:3',
    mainWidth: 1600,
    mainHeight: 2400,
    sizeLabels: ['8 × 12 in', '12 × 18 in', '16 × 24 in', '20 × 30 in', '24 × 36 in', '32 × 48 in', '40 × 60 in'],
  },
  H32: {
    label: 'landscape_3x2',
    ratio: '3:2',
    mainWidth: 2400,
    mainHeight: 1600,
    sizeLabels: ['12 × 8 in', '18 × 12 in', '24 × 16 in', '30 × 20 in', '36 × 24 in', '48 × 32 in', '60 × 40 in'],
  },
};

sharp.cache(false);
sharp.concurrency(4);

function parseArgs(argv) {
  const options = { limit: null, ids: null, orientation: null, roles: null, force: false };
  for (const arg of argv) {
    if (arg.startsWith('--limit=')) options.limit = Number(arg.slice(8));
    else if (arg.startsWith('--ids=')) options.ids = new Set(arg.slice(6).split(',').filter(Boolean));
    else if (arg.startsWith('--orientation=')) options.orientation = arg.slice(14);
    else if (arg.startsWith('--roles=')) {
      options.roles = arg.slice(8).split(',').filter(Boolean);
      const invalidRoles = options.roles.filter((role) => !ALL_ROLES.includes(role));
      if (invalidRoles.length > 0) throw new Error(`Invalid roles: ${invalidRoles.join(', ')}`);
    }
    else if (arg === '--force') options.force = true;
  }
  return options;
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function svg(width, height, body, background = '#ffffff') {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="${background}"/>
      ${body}
    </svg>`,
  );
}

function textSvg(width, height, text, options = {}) {
  const {
    size = 36,
    weight = 600,
    fill = '#1f1e1b',
    x = width / 2,
    y = height / 2,
    anchor = 'middle',
    family = 'Arial, Helvetica, sans-serif',
    letterSpacing = 0,
  } = options;
  return svg(
    width,
    height,
    `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle"
      font-family="${family}" font-size="${size}" font-weight="${weight}"
      letter-spacing="${letterSpacing}" fill="${fill}">${esc(text)}</text>`,
    'transparent',
  );
}

function outputDirFor(item) {
  const orientation = ORIENTATIONS[item.orientationCode];
  const themeSlug = THEME_SLUGS[item.themeCode] ?? item.themeCode.toLowerCase();
  return path.join(MEDIA_ROOT, `${item.themeCode}_${themeSlug}`, orientation.label, item.designId);
}

function outputPathFor(item, role) {
  return path.join(outputDirFor(item), `${item.designId}-${role}.jpg`);
}

function expectedDimensions(item, role) {
  if (role === 'MAIN') {
    const o = ORIENTATIONS[item.orientationCode];
    return { width: o.mainWidth, height: o.mainHeight };
  }
  return { width: 2000, height: 2000 };
}

async function isValidOutput(item, role) {
  const outputPath = outputPathFor(item, role);
  try {
    const meta = await sharp(outputPath).metadata();
    const expected = expectedDimensions(item, role);
    return meta.width === expected.width
      && meta.height === expected.height
      && meta.format === 'jpeg';
  } catch {
    return false;
  }
}

async function atomicJpeg(image, outputPath, quality = 86) {
  const temporaryPath = `${outputPath}.tmp`;
  const buffer = await image
    .flatten({ background: '#ffffff' })
    .jpeg({
      quality,
      progressive: true,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    })
    .toBuffer();
  await fs.writeFile(temporaryPath, buffer);
  await fs.rename(temporaryPath, outputPath);
}

async function artBuffer(sourcePath, width, height) {
  return sharp(sourcePath)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}

async function circularArtBuffer(sourcePath, diameter) {
  const mask = svg(
    diameter,
    diameter,
    `<circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2 - 3}" fill="#ffffff"/>`,
    'transparent',
  );
  return sharp(sourcePath)
    .resize(diameter, diameter, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function buildMain(item, outputPath) {
  const portrait = item.orientationCode === 'V23';
  const width = portrait ? 1600 : 2400;
  const height = portrait ? 2400 : 1600;
  const frontWidth = portrait ? 1408 : 2040;
  const frontHeight = portrait ? 2112 : 1360;
  const frontLeft = portrait ? 150 : 230;
  const frontTop = portrait ? 142 : 105;
  const sideDepth = portrait ? 58 : 72;
  const art = await artBuffer(item.outputPath, frontWidth, frontHeight);

  const shadow = svg(frontWidth, frontHeight, `
    <rect width="${frontWidth}" height="${frontHeight}" rx="2" fill="#6f6559" opacity=".13"/>
  `, 'transparent');
  const side = svg(sideDepth, frontHeight, `
    <defs>
      <linearGradient id="side" x1="0" x2="1">
        <stop offset="0" stop-color="#3b352e"/>
        <stop offset=".45" stop-color="#71675a"/>
        <stop offset="1" stop-color="#b9aa98"/>
      </linearGradient>
    </defs>
    <polygon points="0,18 ${sideDepth},0 ${sideDepth},${frontHeight} 0,${frontHeight - 30}" fill="url(#side)"/>
  `, 'transparent');
  const topEdge = svg(frontWidth + sideDepth, 20, `
    <polygon points="0,18 ${sideDepth},0 ${frontWidth + sideDepth},0 ${frontWidth + sideDepth - 8},13" fill="#d8cbbb" opacity=".92"/>
  `, 'transparent');
  const reflectionHeight = portrait ? 170 : 90;
  const reflection = svg(frontWidth, reflectionHeight, `
    <defs>
      <linearGradient id="reflection" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#b9a994" stop-opacity=".16"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <ellipse cx="${frontWidth / 2}" cy="${portrait ? 44 : 31}" rx="${frontWidth * .46}" ry="${portrait ? 43 : 29}" fill="#8d7c67" opacity=".10"/>
    <path d="M 40 15 H ${frontWidth - 30} V ${reflectionHeight} H 70 Z" fill="url(#reflection)" opacity=".56"/>
  `, 'transparent');

  const mainLayers = [
    { input: shadow, left: frontLeft - 18, top: frontTop + 28 },
    { input: side, left: frontLeft - sideDepth, top: frontTop },
    { input: topEdge, left: frontLeft - sideDepth, top: frontTop },
    { input: art, left: frontLeft, top: frontTop },
  ];
  if (!portrait) mainLayers.push({ input: reflection, left: frontLeft, top: frontTop + frontHeight + 10 });

  await atomicJpeg(
    sharp({
      create: {
        width,
        height,
        channels: 3,
        background: '#ffffff',
      },
    }).composite(mainLayers),
    outputPath,
    88,
  );
}

async function buildFlat(item, outputPath) {
  const portrait = item.orientationCode === 'V23';
  const artWidth = portrait ? 1110 : 1540;
  const artHeight = portrait ? 1665 : 1027;
  const left = Math.round((2000 - artWidth) / 2);
  const top = Math.round((2000 - artHeight) / 2);
  const art = await artBuffer(item.outputPath, artWidth, artHeight);
  const base = svg(2000, 2000, `
    <defs>
      <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f8f5ef"/>
        <stop offset="1" stop-color="#eee9e0"/>
      </linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="180%" height="180%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="22"/>
        <feOffset dx="16" dy="24"/>
        <feColorMatrix type="matrix" values="0 0 0 0 .14 0 0 0 0 .12 0 0 0 0 .10 0 0 0 .28 0"/>
      </filter>
    </defs>
    <rect width="2000" height="2000" fill="url(#paper)"/>
    <rect x="${left}" y="${top}" width="${artWidth}" height="${artHeight}" fill="#7c7165" filter="url(#shadow)"/>
    <polygon points="${left - 24},${top + 15} ${left},${top} ${left},${top + artHeight} ${left - 24},${top + artHeight - 18}" fill="#73695f"/>
    <polygon points="${left - 24},${top + 15} ${left},${top} ${left + artWidth},${top} ${left + artWidth - 5},${top + 9}" fill="#d5c9bb"/>
  `);
  await atomicJpeg(
    sharp(base).composite([{ input: art, left, top }]),
    outputPath,
    88,
  );
}

async function buildScene(item, outputPath) {
  const portrait = item.orientationCode === 'V23';
  const artWidth = portrait ? 650 : 1160;
  const artHeight = portrait ? 975 : 774;
  const left = Math.round((2000 - artWidth) / 2);
  const top = portrait ? 315 : 430;
  const art = await artBuffer(item.outputPath, artWidth, artHeight);
  const base = await sharp(portrait ? TEMPLATE_ASSETS.scenePortrait : TEMPLATE_ASSETS.sceneLandscape)
    .resize(2000, 2000, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const productEffects = svg(2000, 2000, `
    <defs>
      <filter id="shadow" x="-40%" y="-40%" width="200%" height="200%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="18"/>
        <feOffset dx="18" dy="24"/>
        <feColorMatrix type="matrix" values="0 0 0 0 .08 0 0 0 0 .07 0 0 0 0 .06 0 0 0 .40 0"/>
      </filter>
    </defs>
    <rect x="${left}" y="${top}" width="${artWidth}" height="${artHeight}" fill="#554c43" opacity=".72" filter="url(#shadow)"/>
    <polygon points="${left - 24},${top + 16} ${left},${top} ${left},${top + artHeight} ${left - 24},${top + artHeight - 18}" fill="#665c52"/>
    <polygon points="${left - 24},${top + 16} ${left},${top} ${left + artWidth},${top} ${left + artWidth - 8},${top + 11}" fill="#d7cabb"/>
  `, 'transparent');
  await atomicJpeg(
    sharp(base).composite([
      { input: productEffects, left: 0, top: 0 },
      { input: art, left, top },
    ]),
    outputPath,
    82,
  );
}

function detailOverlay(item, front, rear) {
  const bar = 42;
  const stapleYs = Array.from({ length: 9 }, (_, index) => rear.top + 60 + index * ((rear.height - 120) / 8));
  return svg(2000, 2000, `
    <defs>
      <filter id="shadow" x="-40%" y="-40%" width="200%" height="200%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="15"/>
        <feOffset dx="14" dy="20"/>
        <feColorMatrix type="matrix" values="0 0 0 0 .08 0 0 0 0 .07 0 0 0 0 .06 0 0 0 .36 0"/>
      </filter>
      <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ecc78d"/>
        <stop offset=".48" stop-color="#c99658"/>
        <stop offset="1" stop-color="#956338"/>
      </linearGradient>
    </defs>
    <text x="1000" y="112" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="700" fill="#272521">CANVAS CONSTRUCTION</text>
    <text x="1000" y="162" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#6e675e">Front artwork · wrapped edge · rear natural-wood stretcher construction</text>
    <rect x="155" y="205" width="690" height="96" rx="48" fill="#ffffff" opacity=".90"/>
    <rect x="1155" y="205" width="690" height="96" rx="48" fill="#ffffff" opacity=".90"/>
    <text x="500" y="241" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="700" fill="#292621">FRONT &amp; WRAPPED EDGE</text>
    <text x="500" y="274" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#716b63">Artwork ratio preserved</text>
    <text x="1500" y="241" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="700" fill="#292621">REAR WOOD STRETCHER</text>
    <text x="1500" y="274" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#716b63">Folded canvas and staples</text>

    <rect x="${front.left}" y="${front.top}" width="${front.width}" height="${front.height}" fill="#5e554c" opacity=".72" filter="url(#shadow)"/>
    <polygon points="${front.left - 28},${front.top + 17} ${front.left},${front.top} ${front.left},${front.top + front.height} ${front.left - 28},${front.top + front.height - 20}" fill="#635a50"/>
    <polygon points="${front.left - 28},${front.top + 17} ${front.left},${front.top} ${front.left + front.width},${front.top} ${front.left + front.width - 8},${front.top + 12}" fill="#dacdbd"/>

    <rect x="${rear.left}" y="${rear.top}" width="${rear.width}" height="${rear.height}" fill="#d9d1c5" stroke="#ece5d9" stroke-width="18" filter="url(#shadow)"/>
    <path d="M ${rear.left} ${rear.top} L ${rear.left + 62} ${rear.top + 62} L ${rear.left} ${rear.top + 92} Z" fill="#eee6d9"/>
    <path d="M ${rear.left + rear.width} ${rear.top} L ${rear.left + rear.width - 62} ${rear.top + 62} L ${rear.left + rear.width} ${rear.top + 92} Z" fill="#eee6d9"/>
    <path d="M ${rear.left} ${rear.top + rear.height} L ${rear.left + 62} ${rear.top + rear.height - 62} L ${rear.left} ${rear.top + rear.height - 92} Z" fill="#eee6d9"/>
    <path d="M ${rear.left + rear.width} ${rear.top + rear.height} L ${rear.left + rear.width - 62} ${rear.top + rear.height - 62} L ${rear.left + rear.width} ${rear.top + rear.height - 92} Z" fill="#eee6d9"/>
    <rect x="${rear.left + 16}" y="${rear.top + 16}" width="${rear.width - 32}" height="${bar}" fill="url(#wood)"/>
    <rect x="${rear.left + 16}" y="${rear.top + rear.height - bar - 16}" width="${rear.width - 32}" height="${bar}" fill="url(#wood)"/>
    <rect x="${rear.left + 16}" y="${rear.top + 16}" width="${bar}" height="${rear.height - 32}" fill="url(#wood)"/>
    <rect x="${rear.left + rear.width - bar - 16}" y="${rear.top + 16}" width="${bar}" height="${rear.height - 32}" fill="url(#wood)"/>
    <rect x="${rear.left + rear.width / 2 - bar / 2}" y="${rear.top + 35}" width="${bar}" height="${rear.height - 70}" fill="url(#wood)"/>
    <g fill="#77716a">
      ${stapleYs.map((y) => `<rect x="${rear.left + 4}" y="${y}" width="20" height="6" rx="3"/>`).join('')}
      ${stapleYs.map((y) => `<rect x="${rear.left + rear.width - 24}" y="${y}" width="20" height="6" rx="3"/>`).join('')}
    </g>

    <circle cx="${front.left + front.width - 28}" cy="${front.top + front.height - 45}" r="146" fill="#ffffff" stroke="#ffffff" stroke-width="18" filter="url(#shadow)"/>
    <circle cx="${rear.left + rear.width - 18}" cy="${rear.top + rear.height - 36}" r="138" fill="#f5efe6" stroke="#ffffff" stroke-width="18" filter="url(#shadow)"/>
    <g transform="translate(${rear.left + rear.width - 105} ${rear.top + rear.height - 120})">
      <rect x="0" y="0" width="180" height="180" fill="#d9d1c5"/>
      <rect x="0" y="0" width="180" height="38" fill="url(#wood)"/>
      <rect x="0" y="0" width="38" height="180" fill="url(#wood)"/>
      <path d="M 0 0 L 60 60 L 0 92 Z" fill="#efe7db" opacity=".9"/>
      <rect x="16" y="74" width="22" height="6" rx="3" fill="#77716a"/>
      <rect x="16" y="116" width="22" height="6" rx="3" fill="#77716a"/>
    </g>

    <rect x="145" y="1680" width="500" height="178" rx="24" fill="#ffffff" opacity=".92"/>
    <rect x="750" y="1680" width="500" height="178" rx="24" fill="#ffffff" opacity=".92"/>
    <rect x="1355" y="1680" width="500" height="178" rx="24" fill="#ffffff" opacity=".92"/>
    <line x1="340" y1="1722" x2="450" y2="1722" stroke="#aa7656" stroke-width="7"/>
    <line x1="945" y1="1722" x2="1055" y2="1722" stroke="#ceb789" stroke-width="7"/>
    <line x1="1550" y1="1722" x2="1660" y2="1722" stroke="#a98357" stroke-width="7"/>
    <text x="395" y="1780" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="700" fill="#282520">CANVAS TEXTURE</text>
    <text x="1000" y="1780" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="700" fill="#282520">WRAPPED EDGE</text>
    <text x="1605" y="1780" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="700" fill="#282520">WOOD SUPPORT</text>
    <text x="395" y="1827" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="21" fill="#746e66">Visible printed surface</text>
    <text x="1000" y="1827" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="21" fill="#746e66">Clean gallery profile</text>
    <text x="1605" y="1827" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="21" fill="#746e66">Rear stretcher structure</text>
  `, 'transparent');
}

async function buildDetail(item, outputPath) {
  const portrait = item.orientationCode === 'V23';
  const front = portrait
    ? { left: 255, top: 575, width: 560, height: 840 }
    : { left: 150, top: 925, width: 730, height: 487 };
  const rear = portrait
    ? { left: 1220, top: 620, width: 520, height: 780 }
    : { left: 1120, top: 900, width: 740, height: 493 };
  const [base, art, circle] = await Promise.all([
    sharp(TEMPLATE_ASSETS.detailStudio)
      .resize(2000, 2000, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer(),
    artBuffer(item.outputPath, front.width, front.height),
    circularArtBuffer(item.outputPath, 274),
  ]);
  const overlay = detailOverlay(item, front, rear);
  await atomicJpeg(
    sharp(base).composite([
      { input: overlay, left: 0, top: 0 },
      { input: art, left: front.left, top: front.top },
      { input: circle, left: front.left + front.width - 165, top: front.top + front.height - 182 },
    ]),
    outputPath,
    82,
  );
}

function sizeOverlay(item) {
  const orientationName = item.orientationCode === 'V23' ? 'PORTRAIT' : 'LANDSCAPE';
  const arrangement = item.orientationCode === 'V23' ? '5 ABOVE · 2 BELOW' : '4 ABOVE · 3 BELOW';
  return svg(2000, 2000, `
    <rect width="2000" height="2000" fill="#f6f1e9" opacity=".42"/>
    <rect width="2000" height="220" fill="#232321"/>
    <text x="1000" y="88" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="66" font-weight="700" fill="#ffffff">7 AVAILABLE CANVAS SIZES</text>
    <text x="1000" y="151" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="600" fill="#d9d4ca">${orientationName} · ${arrangement} · SMALL TO LARGE</text>
    <rect x="115" y="1862" width="1770" height="92" rx="3" fill="#292826" opacity=".95"/>
    <text x="1000" y="1897" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#ffffff">7 SIZES · TWO ROWS · LEFT-TO-RIGHT PROGRESSION</text>
    <text x="1000" y="1932" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="17" fill="#d8d4ce">Room presentation is illustrative. Confirm the selected physical size before purchase.</text>
  `, 'transparent');
}

function sizePlacements(item) {
  if (item.orientationCode === 'V23') {
    const topWidths = [105, 140, 175, 220, 270];
    const topCenters = [170, 490, 830, 1200, 1650];
    const topBaseline = 760;
    const top = topWidths.map((width, index) => ({
      width,
      height: Math.round(width * 1.5),
      left: Math.round(topCenters[index] - width / 2),
      top: Math.round(topBaseline - width * 1.5),
      label: ORIENTATIONS.V23.sizeLabels[index],
    }));
    const bottomWidths = [350, 440];
    const bottomCenters = [600, 1375];
    const bottomBaseline = 1570;
    const bottom = bottomWidths.map((width, index) => ({
      width,
      height: Math.round(width * 1.5),
      left: Math.round(bottomCenters[index] - width / 2),
      top: Math.round(bottomBaseline - width * 1.5),
      label: ORIENTATIONS.V23.sizeLabels[index + 5],
    }));
    return [...top, ...bottom];
  }

  const topWidths = [220, 300, 380, 460];
  const topCenters = [230, 690, 1180, 1690];
  const topBaseline = 760;
  const top = topWidths.map((width, index) => ({
    width,
    height: Math.round(width * 2 / 3),
    left: Math.round(topCenters[index] - width / 2),
    top: Math.round(topBaseline - width * 2 / 3),
    label: ORIENTATIONS.H32.sizeLabels[index],
  }));
  const bottomWidths = [460, 560, 660];
  const bottomCenters = [300, 1000, 1650];
  const bottomBaseline = 1510;
  const bottom = bottomWidths.map((width, index) => ({
    width,
    height: Math.round(width * 2 / 3),
    left: Math.round(bottomCenters[index] - width / 2),
    top: Math.round(bottomBaseline - width * 2 / 3),
    label: ORIENTATIONS.H32.sizeLabels[index + 4],
  }));
  return [...top, ...bottom];
}

async function buildSize(item, outputPath) {
  const placements = sizePlacements(item);
  const background = await sharp(item.orientationCode === 'V23' ? TEMPLATE_ASSETS.scenePortrait : TEMPLATE_ASSETS.sceneLandscape)
    .resize(2000, 2000, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const layers = [{ input: sizeOverlay(item), left: 0, top: 0 }];
  for (const placement of placements) {
    layers.push({
      input: svg(placement.width + 34, placement.height + 38, `
        <defs>
          <filter id="shadow" x="-40%" y="-40%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="9"/>
            <feOffset dx="8" dy="12"/>
            <feColorMatrix type="matrix" values="0 0 0 0 .08 0 0 0 0 .07 0 0 0 0 .06 0 0 0 .36 0"/>
          </filter>
        </defs>
        <rect x="12" y="8" width="${placement.width}" height="${placement.height}" fill="#544b42" filter="url(#shadow)"/>
        <polygon points="0,20 12,8 12,${placement.height + 8} 0,${placement.height - 4}" fill="#655b51"/>
      `, 'transparent'),
      left: placement.left - 12,
      top: placement.top - 8,
    });
    layers.push({
      input: await artBuffer(item.outputPath, placement.width, placement.height),
      left: placement.left,
      top: placement.top,
    });
    const labelWidth = Math.max(210, Math.round(placement.width * 0.70));
    const labelHeight = 76;
    layers.push({
      input: svg(labelWidth, labelHeight, `
        <rect x="2" y="2" width="${labelWidth - 4}" height="${labelHeight - 4}" rx="7" fill="#ffffff" stroke="#d5cec3" stroke-width="4"/>
        <text x="${labelWidth / 2}" y="${labelHeight / 2 + 1}" text-anchor="middle" dominant-baseline="middle"
          font-family="Arial, Helvetica, sans-serif" font-size="40"
          font-weight="700" fill="#25231f">${esc(placement.label)}</text>
      `, 'transparent'),
      left: Math.round(placement.left + placement.width / 2 - labelWidth / 2),
      top: Math.round(placement.top + placement.height + 18),
    });
  }
  await atomicJpeg(
    sharp(background).composite(layers),
    outputPath,
    82,
  );
}

async function boundaryEdgeBuffers(item, faceWidth, faceHeight, rightWidth = 6, bottomHeight = 4) {
  const meta = await sharp(item.outputPath).metadata();
  const rightSourceWidth = Math.min(8, meta.width);
  const bottomSourceHeight = Math.min(8, meta.height);
  const [right, bottom] = await Promise.all([
    sharp(item.outputPath)
      .extract({ left: meta.width - rightSourceWidth, top: 0, width: rightSourceWidth, height: meta.height })
      .resize(rightWidth, faceHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .modulate({ brightness: 0.72, saturation: 0.92 })
      .png()
      .toBuffer(),
    sharp(item.outputPath)
      .extract({ left: 0, top: meta.height - bottomSourceHeight, width: meta.width, height: bottomSourceHeight })
      .resize(faceWidth, bottomHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .modulate({ brightness: 0.67, saturation: 0.90 })
      .png()
      .toBuffer(),
  ]);
  return { right, bottom };
}

async function secondaryProductLayers(item, faceWidth, faceHeight, left, top, edgeScale = 1) {
  const rightWidth = Math.max(3, Math.min(8, Math.round(6 * edgeScale)));
  const bottomHeight = Math.max(2, Math.min(5, Math.round(4 * edgeScale)));
  const [art, edges] = await Promise.all([
    artBuffer(item.outputPath, faceWidth, faceHeight),
    boundaryEdgeBuffers(item, faceWidth, faceHeight, rightWidth, bottomHeight),
  ]);
  const shadow = svg(faceWidth + 48, faceHeight + 48, `
    <defs>
      <filter id='contact' x='-30%' y='-30%' width='180%' height='180%'>
        <feGaussianBlur in='SourceAlpha' stdDeviation='10'/>
        <feOffset dx='10' dy='13'/>
        <feColorMatrix type='matrix' values='0 0 0 0 .06 0 0 0 0 .05 0 0 0 0 .04 0 0 0 .42 0'/>
      </filter>
    </defs>
    <rect x='18' y='18' width='${faceWidth}' height='${faceHeight}' fill='#5a5148' opacity='.88' filter='url(#contact)'/>
  `, 'transparent');
  return [
    { input: shadow, left: left - 18, top: top - 18 },
    { input: edges.right, left: left + faceWidth, top },
    { input: edges.bottom, left, top: top + faceHeight },
    { input: art, left, top },
  ];
}

function sceneConfig(item, role) {
  if (item.orientationCode === 'V23' && role === 'SCENE-LIVING') {
    return { asset: TEMPLATE_ASSETS.scenePortraitLiving, width: 560, height: 840, left: 720, top: 245 };
  }
  if (item.orientationCode === 'V23' && role === 'SCENE-DINING') {
    return { asset: TEMPLATE_ASSETS.scenePortraitDining, width: 520, height: 780, left: 740, top: 215 };
  }
  if (item.orientationCode === 'H32' && role === 'SCENE-BEDROOM') {
    return { asset: TEMPLATE_ASSETS.sceneLandscapeBedroom, width: 1160, height: 773, left: 500, top: 145 };
  }
  if (item.orientationCode === 'H32' && role === 'SCENE-LIVING') {
    return { asset: TEMPLATE_ASSETS.sceneLandscapeLiving, width: 1160, height: 773, left: 420, top: 220 };
  }
  throw new Error(`Unsupported scene role ${item.designId} ${role}`);
}

async function buildSceneV5(item, outputPath, role) {
  const config = sceneConfig(item, role);
  const base = await sharp(config.asset)
    .resize(2000, 2000, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 91, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const layers = await secondaryProductLayers(item, config.width, config.height, config.left, config.top);
  await atomicJpeg(sharp(base).composite(layers), outputPath, 88);
}

function constructionCircle(kind, diameter = 300) {
  const common = `<defs>
    <clipPath id='clip'><circle cx='${diameter / 2}' cy='${diameter / 2}' r='${diameter / 2 - 8}'/></clipPath>
    <linearGradient id='wood' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='#edca91'/><stop offset='.5' stop-color='#c58e52'/><stop offset='1' stop-color='#8d5930'/>
    </linearGradient>
  </defs>`;
  let body = '';
  if (kind === 'SOLID WOOD STRETCHER') {
    body = `<rect width='${diameter}' height='${diameter}' fill='#e8dfd2'/>
      <rect x='46' y='46' width='208' height='48' fill='url(#wood)'/>
      <rect x='46' y='46' width='48' height='208' fill='url(#wood)'/>
      <path d='M46 46 L115 115 L46 150 Z' fill='#f1e7d8' opacity='.9'/>`;
  } else if (kind === 'STURDY STAPLE BINDING') {
    const staples = Array.from({ length: 6 }, (_, index) => `<rect x='54' y='${65 + index * 31}' width='38' height='8' rx='4' fill='#77716a'/>`).join('');
    body = `<rect width='${diameter}' height='${diameter}' fill='#ddd4c7'/>
      <rect x='92' y='0' width='208' height='${diameter}' fill='#c79357'/>
      <path d='M92 0 L155 63 L92 110 Z' fill='#eee3d4'/>${staples}`;
  } else {
    body = `<rect width='${diameter}' height='${diameter}' fill='#ded5c8'/>
      <rect x='40' y='40' width='220' height='220' fill='none' stroke='url(#wood)' stroke-width='42'/>
      <rect x='130' y='60' width='40' height='180' fill='url(#wood)'/>
      <path d='M40 40 L112 112 L40 146 Z' fill='#f0e5d7' opacity='.88'/>`;
  }
  return svg(diameter, diameter, `${common}<g clip-path='url(#clip)'>${body}</g><circle cx='${diameter / 2}' cy='${diameter / 2}' r='${diameter / 2 - 8}' fill='none' stroke='#ffffff' stroke-width='16'/><circle cx='${diameter / 2}' cy='${diameter / 2}' r='${diameter / 2 - 3}' fill='none' stroke='#c9beb0' stroke-width='5'/>`, 'transparent');
}

async function buildDetailV5(item, outputPath) {
  const portrait = item.orientationCode === 'V23';
  const product = portrait
    ? { width: 420, height: 630, left: 790, top: 535 }
    : { width: 780, height: 520, left: 610, top: 590 };
  const callouts = [
    { label: 'SOLID WOOD STRETCHER', left: 205, top: 345, kind: 'SOLID WOOD STRETCHER' },
    { label: 'PREMIUM CANVAS', left: 1495, top: 345, kind: 'PREMIUM CANVAS' },
    { label: 'STURDY STAPLE BINDING', left: 205, top: 1260, kind: 'STURDY STAPLE BINDING' },
    { label: 'REAR WOOD FRAME', left: 1495, top: 1260, kind: 'REAR WOOD FRAME' },
  ];
  const base = svg(2000, 2000, `
    <defs>
      <linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fbfaf7'/><stop offset='1' stop-color='#eee8df'/></linearGradient>
    </defs>
    <rect width='2000' height='2000' fill='url(#bg)'/>
    <text x='1000' y='100' text-anchor='middle' dominant-baseline='middle' font-family='Arial, Helvetica, sans-serif' font-size='68' font-weight='700' fill='#27241f'>PRODUCT COMPOSITION</text>
    <text x='1000' y='162' text-anchor='middle' dominant-baseline='middle' font-family='Arial, Helvetica, sans-serif' font-size='25' fill='#706a62'>Gallery-wrapped canvas construction</text>
    <g fill='none' stroke='#9b8e7e' stroke-width='5' stroke-dasharray='18 16' opacity='.9'>
      <path d='M505 500 C650 500 690 650 790 700'/>
      <path d='M1495 500 C1360 500 1320 650 1210 700'/>
      <path d='M505 1410 C640 1410 690 1120 790 1050'/>
      <path d='M1495 1410 C1360 1410 1310 1120 1210 1050'/>
    </g>
    <rect x='450' y='1745' width='1100' height='82' rx='41' fill='#272521'/>
    <text x='1000' y='1787' text-anchor='middle' dominant-baseline='middle' font-family='Arial, Helvetica, sans-serif' font-size='28' font-weight='700' fill='#ffffff'>ORIGINAL ARTWORK · INTERNAL WOOD STRETCHER</text>
  `);
  const layers = [{ input: base, left: 0, top: 0 }, ...(await secondaryProductLayers(item, product.width, product.height, product.left, product.top))];
  for (const callout of callouts) {
    const circle = callout.kind === 'PREMIUM CANVAS'
      ? await circularArtBuffer(item.outputPath, 300)
      : constructionCircle(callout.kind, 300);
    layers.push({ input: circle, left: callout.left, top: callout.top });
    const badgeWidth = 420;
    layers.push({
      input: svg(badgeWidth, 78, `<rect x='2' y='2' width='${badgeWidth - 4}' height='74' rx='37' fill='#ffffff' stroke='#d2c8bb' stroke-width='4'/><text x='${badgeWidth / 2}' y='40' text-anchor='middle' dominant-baseline='middle' font-family='Arial, Helvetica, sans-serif' font-size='25' font-weight='700' fill='#2d2924'>${esc(callout.label)}</text>`, 'transparent'),
      left: callout.left - 60,
      top: callout.top + 320,
    });
  }
  await atomicJpeg(sharp({ create: { width: 2000, height: 2000, channels: 3, background: '#ffffff' } }).composite(layers), outputPath, 88);
}

function sizePlacementsV5(item) {
  if (item.orientationCode === 'V23') {
    const widths = [80, 110, 140, 175, 215, 300, 400];
    const centers = [125, 410, 730, 1070, 1570, 560, 1390];
    return widths.map((width, index) => {
      const row = index < 5 ? 1 : 2;
      const baseline = row === 1 ? 720 : 1540;
      return { width, height: Math.round(width * 1.5), left: Math.round(centers[index] - width / 2), top: Math.round(baseline - width * 1.5), baseline, label: ORIENTATIONS.V23.sizeLabels[index] };
    });
  }
  const widths = [150, 210, 270, 340, 420, 620, 780];
  const centers = [125, 410, 725, 1085, 1590, 545, 1400];
  return widths.map((width, index) => {
    const row = index < 5 ? 1 : 2;
    const baseline = row === 1 ? 720 : 1480;
    return { width, height: Math.round(width * 2 / 3), left: Math.round(centers[index] - width / 2), top: Math.round(baseline - width * 2 / 3), baseline, label: ORIENTATIONS.H32.sizeLabels[index] };
  });
}

async function buildSizeV5(item, outputPath) {
  const background = svg(2000, 2000, `
    <defs><linearGradient id='wall' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fffefd'/><stop offset='1' stop-color='#eee8df'/></linearGradient></defs>
    <rect width='2000' height='2000' fill='url(#wall)'/>
    <rect width='2000' height='210' fill='#252320'/>
    <text x='1000' y='82' text-anchor='middle' dominant-baseline='middle' font-family='Arial, Helvetica, sans-serif' font-size='64' font-weight='700' fill='#ffffff'>7 AVAILABLE CANVAS SIZES</text>
    <text x='1000' y='148' text-anchor='middle' dominant-baseline='middle' font-family='Arial, Helvetica, sans-serif' font-size='25' fill='#d9d4cb'>${item.orientationCode === 'V23' ? 'PORTRAIT' : 'LANDSCAPE'} · SMALL TO LARGE · 5 + 2 LAYOUT</text>
    <path d='M0 1760 C260 1680 500 1705 750 1760 C1050 1660 1400 1685 2000 1760 V2000 H0 Z' fill='#f5f1eb'/>
    <path d='M100 1840 C300 1720 640 1735 900 1840 C1170 1725 1540 1730 1900 1840 V2000 H100 Z' fill='#ffffff' stroke='#ddd6cc' stroke-width='5'/>
  `);
  const layers = [{ input: background, left: 0, top: 0 }];
  for (const placement of sizePlacementsV5(item)) {
    const scale = Math.min(1.25, Math.max(0.58, placement.width / 340));
    layers.push(...await secondaryProductLayers(item, placement.width, placement.height, placement.left, placement.top, scale));
    const labelWidth = Math.max(205, Math.round(placement.width * 0.72));
    const labelHeight = 76;
    layers.push({
      input: svg(labelWidth, labelHeight, `<rect x='2' y='2' width='${labelWidth - 4}' height='${labelHeight - 4}' rx='8' fill='#ffffff' stroke='#cfc6b9' stroke-width='4'/><text x='${labelWidth / 2}' y='${labelHeight / 2 + 1}' text-anchor='middle' dominant-baseline='middle' font-family='Arial, Helvetica, sans-serif' font-size='40' font-weight='700' fill='#24211d'>${esc(placement.label)}</text>`, 'transparent'),
      left: Math.round(placement.left + placement.width / 2 - labelWidth / 2),
      top: placement.baseline + 18,
    });
  }
  await atomicJpeg(sharp({ create: { width: 2000, height: 2000, channels: 3, background: '#ffffff' } }).composite(layers), outputPath, 88);
}

const BUILDERS = {
  MAIN: buildMain,
  DETAIL: buildDetailV5,
  'SCENE-LIVING': buildSceneV5,
  'SCENE-DINING': buildSceneV5,
  'SCENE-BEDROOM': buildSceneV5,
  SIZE: buildSizeV5,
};

async function validateSource(item) {
  const meta = await sharp(item.outputPath).metadata();
  const expected = item.orientationCode === 'V23'
    ? { width: 1024, height: 1536 }
    : { width: 1536, height: 1024 };
  if (meta.width !== expected.width || meta.height !== expected.height || meta.format !== 'png') {
    throw new Error(`Invalid source ${item.designId}: ${meta.width}x${meta.height} ${meta.format}`);
  }
}

async function processDesign(item, force = false, selectedRoles = null) {
  await validateSource(item);
  await fs.mkdir(outputDirFor(item), { recursive: true });
  const allowedRoles = ROLE_SETS[item.orientationCode];
  const roles = (selectedRoles ?? allowedRoles).filter((role) => allowedRoles.includes(role));
  if (roles.length === 0) throw new Error(`No applicable roles selected for ${item.designId}`);
  const generated = [];
  const retained = [];
  for (const role of roles) {
    if (!force && await isValidOutput(item, role)) {
      retained.push(role);
      continue;
    }
    await BUILDERS[role](item, outputPathFor(item, role), role);
    if (!(await isValidOutput(item, role))) {
      throw new Error(`Post-build validation failed: ${item.designId} ${role}`);
    }
    generated.push(role);
  }
  return { designId: item.designId, generated, retained };
}

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function csvEscape(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

async function writeMediaManifest(sourceManifest) {
  const records = [];
  for (const item of sourceManifest) {
    for (const role of ROLE_SETS[item.orientationCode]) {
      const localPath = outputPathFor(item, role);
      try {
        const [meta, stat, hash] = await Promise.all([
          sharp(localPath).metadata(),
          fs.stat(localPath),
          sha256(localPath),
        ]);
        const repoPath = path.relative(PROJECT_ROOT, localPath).split(path.sep).join('/');
        records.push({
          designId: item.designId,
          themeCode: item.themeCode,
          themeName: item.themeName,
          orientationCode: item.orientationCode,
          ratio: item.ratio,
          role,
          width: meta.width,
          height: meta.height,
          format: meta.format,
          sizeBytes: stat.size,
          sha256: hash,
          localPath,
          repoPath,
          githubRawUrl: `${RAW_BASE}/${repoPath.split('/').map(encodeURIComponent).join('/')}`,
        });
      } catch {
        // Missing media are represented by absence from the current checkpoint manifest.
      }
    }
  }
  records.sort((a, b) => a.designId.localeCompare(b.designId) || ALL_ROLES.indexOf(a.role) - ALL_ROLES.indexOf(b.role));
  const jsonPath = path.join(PROJECT_ROOT, 'media_manifest.json');
  await fs.writeFile(jsonPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  const columns = [
    'designId', 'themeCode', 'themeName', 'orientationCode', 'ratio', 'role',
    'width', 'height', 'format', 'sizeBytes', 'sha256', 'localPath', 'repoPath', 'githubRawUrl',
  ];
  const csv = [
    columns.join(','),
    ...records.map((record) => columns.map((column) => csvEscape(record[column])).join(',')),
  ].join('\n');
  await fs.writeFile(path.join(PROJECT_ROOT, 'media_manifest.csv'), `${csv}\n`, 'utf8');
  return records;
}

async function writeProgress(sourceManifest, records, selectedCount, startedAt) {
  const completedDesignIds = sourceManifest
    .filter((item) => ROLE_SETS[item.orientationCode].every((role) => records.some((record) => record.designId === item.designId && record.role === role)))
    .map((item) => item.designId);
  const progress = {
    project: 'amazon_us_fresh_canvas_media_400_v5_noflat_20260820',
    sourceProject: 'amazon_us_fresh_flat_art_400_20260820',
    repository: REPOSITORY,
    startedAt,
    updatedAt: new Date().toISOString(),
    expectedDesigns: 400,
    expectedRolesPerDesign: 5,
    expectedFiles: 2000,
    selectedThisRun: selectedCount,
    completedDesigns: completedDesignIds.length,
    completedFiles: records.length,
    pendingDesigns: sourceManifest.length - completedDesignIds.length,
    nextPendingDesignId: sourceManifest.find((item) => !completedDesignIds.includes(item.designId))?.designId ?? null,
  };
  await fs.writeFile(path.join(PROJECT_ROOT, 'generation_progress.json'), `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
  return progress;
}

async function runPool(items, concurrency, worker, onComplete) {
  let cursor = 0;
  const errors = [];
  async function lane() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        const result = await worker(items[index], index);
        await onComplete(result, index);
      } catch (error) {
        errors.push({ designId: items[index].designId, message: error.message, stack: error.stack });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => lane()));
  return errors;
}

const options = parseArgs(process.argv.slice(2));
const startedAt = new Date().toISOString();
const sourceManifest = JSON.parse(await fs.readFile(SOURCE_MANIFEST_PATH, 'utf8'));
if (sourceManifest.length !== 400) {
  throw new Error(`Expected 400 source designs, received ${sourceManifest.length}`);
}

let selected = sourceManifest;
if (options.ids) selected = selected.filter((item) => options.ids.has(item.designId));
if (options.orientation) selected = selected.filter((item) => item.orientationCode === options.orientation);
if (Number.isFinite(options.limit) && options.limit > 0) selected = selected.slice(0, options.limit);
if (selected.length === 0) throw new Error('No source designs selected');

await fs.mkdir(MEDIA_ROOT, { recursive: true });
let completedThisRun = 0;
const errors = await runPool(
  selected,
  3,
  (item) => processDesign(item, options.force, options.roles),
  async (result) => {
    completedThisRun += 1;
    if (completedThisRun % 5 === 0 || completedThisRun === selected.length) {
      const checkpointRecords = await writeMediaManifest(sourceManifest);
      const progress = await writeProgress(sourceManifest, checkpointRecords, selected.length, startedAt);
      console.log(JSON.stringify({
        completedThisRun,
        selected: selected.length,
        designId: result.designId,
        generated: result.generated,
        retained: result.retained,
        completedDesigns: progress.completedDesigns,
        completedFiles: progress.completedFiles,
        nextPendingDesignId: progress.nextPendingDesignId,
      }));
    }
  },
);

const records = await writeMediaManifest(sourceManifest);
const progress = await writeProgress(sourceManifest, records, selected.length, startedAt);
await fs.writeFile(path.join(PROJECT_ROOT, 'generation_errors.json'), `${JSON.stringify(errors, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  status: errors.length === 0 ? 'PASS' : 'PARTIAL_WITH_ERRORS',
  selected: selected.length,
  errors: errors.length,
  progress,
}, null, 2));

if (errors.length > 0) process.exitCode = 1;
