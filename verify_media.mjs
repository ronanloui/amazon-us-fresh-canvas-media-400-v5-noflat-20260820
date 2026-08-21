import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const PROJECT_ROOT = '/Users/leo/Documents/ChatGPT/亚马逊/outputs/amazon_us_fresh_canvas_media_400_v5_noflat_20260820';
const SOURCE_ROOT = '/Users/leo/Documents/ChatGPT/亚马逊/outputs/amazon_us_fresh_flat_art_400_20260820';
const SOURCE_MANIFEST_PATH = path.join(SOURCE_ROOT, 'fresh_generation_manifest.json');
const MEDIA_MANIFEST_PATH = path.join(PROJECT_ROOT, 'media_manifest.json');
const MEDIA_ROOT = path.join(PROJECT_ROOT, 'media');
const CONTACT_ROOT = path.join(PROJECT_ROOT, 'qa', 'contact_sheets');
const TEMPLATE_LOCK_PATH = path.join(PROJECT_ROOT, 'template_lock_manifest.json');
const TEMPLATE_ASSET_ROOT = path.join(PROJECT_ROOT, 'template_assets');
const ROLE_SETS = {
  V23: ['MAIN', 'DETAIL', 'SCENE-LIVING', 'SCENE-DINING', 'SIZE'],
  H32: ['MAIN', 'DETAIL', 'SCENE-LIVING', 'SCENE-BEDROOM', 'SIZE'],
};
const ROLES = ['MAIN', 'DETAIL', 'SCENE-LIVING', 'SCENE-DINING', 'SCENE-BEDROOM', 'SIZE'];

sharp.cache(false);
sharp.concurrency(6);

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

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function walkJpegs(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walkJpegs(fullPath));
    else if (entry.isFile() && /\.jpe?g$/i.test(entry.name)) output.push(fullPath);
  }
  return output;
}

function placementFor(item, role) {
  const portrait = item.orientationCode === 'V23';
  if (role === 'MAIN') {
    return portrait
      ? { left: 150, top: 142, width: 1408, height: 2112, compare: 'full' }
      : { left: 230, top: 105, width: 2040, height: 1360, compare: 'full' };
  }
  if (role === 'DETAIL') {
    return portrait
      ? { left: 790, top: 535, width: 420, height: 630, compare: 'full' }
      : { left: 610, top: 590, width: 780, height: 520, compare: 'full' };
  }
  if (role === 'SCENE-LIVING') {
    return portrait
      ? { left: 720, top: 245, width: 560, height: 840, compare: 'full' }
      : { left: 420, top: 220, width: 1160, height: 773, compare: 'full' };
  }
  if (role === 'SCENE-DINING') return { left: 740, top: 215, width: 520, height: 780, compare: 'full' };
  if (role === 'SCENE-BEDROOM') return { left: 500, top: 145, width: 1160, height: 773, compare: 'full' };
  return null;
}

function independentSizeLayout(orientationCode) {
  if (orientationCode === 'V23') {
    const topWidths = [80, 110, 140, 175, 215];
    const bottomWidths = [300, 400];
    return [
      ...topWidths.map((width) => ({ width, height: Math.round(width * 1.5), baseline: 720, row: 1 })),
      ...bottomWidths.map((width) => ({ width, height: Math.round(width * 1.5), baseline: 1540, row: 2 })),
    ].map((entry) => ({ ...entry, labelTop: entry.baseline + 18, labelHeight: 76 }));
  }
  const topWidths = [150, 210, 270, 340, 420];
  const bottomWidths = [620, 780];
  return [
    ...topWidths.map((width) => ({ width, height: Math.round(width * 2 / 3), baseline: 720, row: 1 })),
    ...bottomWidths.map((width) => ({ width, height: Math.round(width * 2 / 3), baseline: 1480, row: 2 })),
  ].map((entry) => ({ ...entry, labelTop: entry.baseline + 18, labelHeight: 76 }));
}

async function meanAbsoluteError(record, sourceItem) {
  const placement = placementFor(sourceItem, record.role);
  if (!placement) return null;

  const outputSample = await sharp(record.localPath)
    .extract({ left: placement.left, top: placement.top, width: placement.width, height: placement.height })
    .resize(96, 96, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  const fullSourceBuffer = await sharp(sourceItem.outputPath)
    .resize(
      placement.fullWidth ?? placement.width,
      placement.fullHeight ?? placement.height,
      { fit: 'fill', kernel: sharp.kernel.lanczos3 },
    )
    .png()
    .toBuffer();
  let sourcePipeline = sharp(fullSourceBuffer);
  if (placement.compare === 'patch') {
    sourcePipeline = sourcePipeline.extract({
      left: 0,
      top: 0,
      width: placement.width,
      height: placement.height,
    });
  }
  const sourceSample = await sourcePipeline
    .resize(96, 96, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  if (outputSample.length !== sourceSample.length) {
    throw new Error(`Sample channel mismatch for ${record.designId} ${record.role}`);
  }
  let total = 0;
  for (let index = 0; index < outputSample.length; index += 1) {
    total += Math.abs(outputSample[index] - sourceSample[index]);
  }
  return total / outputSample.length;
}

async function mainCornerMinimum(record) {
  const size = 40;
  const corners = [
    { left: 0, top: 0 },
    { left: record.width - size, top: 0 },
    { left: 0, top: record.height - size },
    { left: record.width - size, top: record.height - size },
  ];
  let minimum = 255;
  for (const corner of corners) {
    const { data, info } = await sharp(record.localPath)
      .extract({ ...corner, width: size, height: size })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let total = 0;
    for (let index = 0; index < data.length; index += info.channels) {
      total += data[index] + data[index + 1] + data[index + 2];
    }
    const average = total / ((data.length / info.channels) * 3);
    minimum = Math.min(minimum, average);
  }
  return minimum;
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const results = [];
  async function lane() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => lane()));
  return results;
}

async function buildContactSheet(role, samples, recordByKey) {
  const cell = 500;
  const layers = [];
  for (let index = 0; index < samples.length; index += 1) {
    const item = samples[index];
    const record = recordByKey.get(`${item.designId}|${role}`);
    const column = index % 4;
    const row = Math.floor(index / 4);
    const thumb = await sharp(record.localPath)
      .resize(470, 420, { fit: 'contain', background: '#f4f0e9' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    layers.push({
      input: thumb,
      left: column * cell + 15,
      top: row * cell + 15,
    });
    layers.push({
      input: svg(470, 50, `
        <rect width="470" height="50" fill="#252421" opacity=".96"/>
        <text x="235" y="19" text-anchor="middle" dominant-baseline="middle"
          font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" fill="#ffffff">${esc(item.designId)} · ${esc(role)}</text>
        <text x="235" y="38" text-anchor="middle" dominant-baseline="middle"
          font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#d8d2c8">${esc(item.themeCode)} · ${esc(item.orientationCode)} · ${esc(item.ratio)}</text>
      `, 'transparent'),
      left: column * cell + 15,
      top: row * cell + 435,
    });
  }
  const outputPath = path.join(CONTACT_ROOT, `${role.toLowerCase()}_16_theme_orientation_samples.jpg`);
  await sharp({
    create: {
      width: 2000,
      height: 2000,
      channels: 3,
      background: '#ded8cf',
    },
  }).composite(layers).jpeg({ quality: 86, mozjpeg: true, progressive: true }).toFile(outputPath);
  return outputPath;
}

const sourceManifest = JSON.parse(await fs.readFile(SOURCE_MANIFEST_PATH, 'utf8'));
const mediaManifest = JSON.parse(await fs.readFile(MEDIA_MANIFEST_PATH, 'utf8'));
const templateLock = JSON.parse(await fs.readFile(TEMPLATE_LOCK_PATH, 'utf8'));
const sourceById = new Map(sourceManifest.map((item) => [item.designId, item]));
const errors = [];
const warnings = [];
const templateAssetChecks = [];
for (const [assetName, expectedSha256] of Object.entries(templateLock.templateAssetSha256)) {
  const assetPath = path.join(TEMPLATE_ASSET_ROOT, assetName);
  const actualSha256 = await sha256(assetPath);
  templateAssetChecks.push({ assetName, expectedSha256, actualSha256, match: expectedSha256 === actualSha256 });
  if (expectedSha256 !== actualSha256) errors.push(`Locked template asset changed: ${assetName}`);
}
if (templateLock.flatRoleAllowed !== false) errors.push('Template lock must prohibit FLAT');

if (sourceManifest.length !== 400) errors.push(`Source manifest expected 400 designs, found ${sourceManifest.length}`);
if (mediaManifest.length !== 2000) errors.push(`Media manifest expected 2000 files, found ${mediaManifest.length}`);

const actualFiles = await walkJpegs(MEDIA_ROOT);
if (actualFiles.length !== 2000) errors.push(`Filesystem expected 2000 JPEGs, found ${actualFiles.length}`);

const designRoles = new Map();
for (const record of mediaManifest) {
  if (!designRoles.has(record.designId)) designRoles.set(record.designId, []);
  designRoles.get(record.designId).push(record.role);
}
for (const item of sourceManifest) {
  const roles = designRoles.get(item.designId) ?? [];
  for (const role of ROLE_SETS[item.orientationCode]) {
    if (!roles.includes(role)) errors.push(`Missing ${role} for ${item.designId}`);
  }
  if (roles.length !== 5) errors.push(`Expected 5 roles for ${item.designId}, found ${roles.length}`);
  const unexpectedRoles = roles.filter((role) => !ROLE_SETS[item.orientationCode].includes(role));
  if (unexpectedRoles.length) errors.push(`Unexpected roles for ${item.designId}: ${unexpectedRoles.join(', ')}`);
}
if (mediaManifest.some((record) => record.role === 'FLAT')) errors.push('FLAT role is prohibited by the locked template');
if (actualFiles.some((filePath) => /-FLAT\.jpe?g$/i.test(filePath))) errors.push('FLAT file exists on disk');

const checked = await runPool(mediaManifest, 8, async (record) => {
  const sourceItem = sourceById.get(record.designId);
  if (!sourceItem) {
    return { record, error: `Unknown design ID ${record.designId}` };
  }
  try {
    const [meta, stat, hash, mae, cornerMinimum] = await Promise.all([
      sharp(record.localPath).metadata(),
      fs.stat(record.localPath),
      sha256(record.localPath),
      meanAbsoluteError(record, sourceItem),
      record.role === 'MAIN' ? mainCornerMinimum(record) : Promise.resolve(null),
    ]);
    await sharp(record.localPath).stats();
    const expected = record.role === 'MAIN'
      ? (record.orientationCode === 'V23' ? { width: 1600, height: 2400 } : { width: 2400, height: 1600 })
      : { width: 2000, height: 2000 };
    const localErrors = [];
    if (meta.format !== 'jpeg') localErrors.push(`format=${meta.format}`);
    if (meta.width !== expected.width || meta.height !== expected.height) {
      localErrors.push(`dimensions=${meta.width}x${meta.height}, expected=${expected.width}x${expected.height}`);
    }
    if (stat.size < 45_000) localErrors.push(`file too small=${stat.size}`);
    if (hash !== record.sha256) localErrors.push('sha256 differs from manifest');
    if (mae !== null && mae > 8) localErrors.push(`artwork MAE too high=${mae.toFixed(3)}`);
    if (cornerMinimum !== null && cornerMinimum < 242) localErrors.push(`MAIN corner white minimum too low=${cornerMinimum.toFixed(2)}`);
    return {
      record,
      hash,
      sizeBytes: stat.size,
      mae,
      cornerMinimum,
      error: localErrors.length > 0 ? localErrors.join('; ') : null,
    };
  } catch (error) {
    return { record, error: error.message };
  }
});

for (const result of checked) {
  if (result.error) errors.push(`${result.record.designId} ${result.record.role}: ${result.error}`);
}

const hashes = checked.filter((item) => item.hash).map((item) => item.hash);
const uniqueHashes = new Set(hashes);
if (uniqueHashes.size !== 2000) errors.push(`Expected 2000 unique hashes, found ${uniqueHashes.size}`);

const roleCounts = Object.fromEntries(ROLES.map((role) => [role, mediaManifest.filter((record) => record.role === role).length]));
const expectedRoleCounts = { MAIN: 400, DETAIL: 400, 'SCENE-LIVING': 400, 'SCENE-DINING': 200, 'SCENE-BEDROOM': 200, SIZE: 400 };
for (const [role, expected] of Object.entries(expectedRoleCounts)) {
  if (roleCounts[role] !== expected) errors.push(`Role ${role} expected ${expected}, found ${roleCounts[role]}`);
}
const orientationCounts = {
  V23: mediaManifest.filter((record) => record.orientationCode === 'V23').length,
  H32: mediaManifest.filter((record) => record.orientationCode === 'H32').length,
};
const designOrientationCounts = {
  V23: sourceManifest.filter((item) => item.orientationCode === 'V23').length,
  H32: sourceManifest.filter((item) => item.orientationCode === 'H32').length,
};
const sizeLayoutChecks = sourceManifest.map((item) => {
  const layout = independentSizeLayout(item.orientationCode);
  const expectedRows = [5, 2];
  const actualRows = [layout.filter((entry) => entry.row === 1).length, layout.filter((entry) => entry.row === 2).length];
  const labelsBelowArtwork = layout.every((entry) => entry.labelTop >= entry.baseline + 18);
  const labelsClearFooter = layout.every((entry) => entry.labelTop + entry.labelHeight < 1862);
  return { designId: item.designId, expectedRows, actualRows, labelsBelowArtwork, labelsClearFooter };
});
for (const check of sizeLayoutChecks) {
  if (check.actualRows.join(',') !== check.expectedRows.join(',')) errors.push(`SIZE row layout mismatch for ${check.designId}`);
  if (!check.labelsBelowArtwork) errors.push(`SIZE label overlaps artwork for ${check.designId}`);
  if (!check.labelsClearFooter) errors.push(`SIZE label overlaps footer for ${check.designId}`);
}
const themeCounts = {};
for (const item of sourceManifest) {
  if (!themeCounts[item.themeCode]) {
    themeCounts[item.themeCode] = {
      themeName: item.themeName,
      portraitDesigns: 0,
      landscapeDesigns: 0,
      designs: 0,
      files: 0,
    };
  }
  const entry = themeCounts[item.themeCode];
  entry[item.orientationCode === 'V23' ? 'portraitDesigns' : 'landscapeDesigns'] += 1;
  entry.designs += 1;
  entry.files += 5;
}

const maeValues = checked.map((item) => item.mae).filter((value) => value !== null && value !== undefined);
const cornerValues = checked.map((item) => item.cornerMinimum).filter((value) => value !== null && value !== undefined);
const totalBytes = checked.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);

const sampleItems = [];
for (const themeCode of Object.keys(themeCounts).sort()) {
  for (const orientationCode of ['V23', 'H32']) {
    const sample = sourceManifest.find((item) => item.themeCode === themeCode && item.orientationCode === orientationCode);
    if (sample) sampleItems.push(sample);
  }
}

await fs.mkdir(CONTACT_ROOT, { recursive: true });
const recordByKey = new Map(mediaManifest.map((record) => [`${record.designId}|${record.role}`, record]));
const contactSheets = [];
for (const role of ROLES) {
  const roleSamples = sampleItems.filter((item) => ROLE_SETS[item.orientationCode].includes(role));
  contactSheets.push(await buildContactSheet(role, roleSamples, recordByKey));
}

const report = {
  status: errors.length === 0 ? 'PASS' : 'FAIL',
  checkedAt: new Date().toISOString(),
  project: 'amazon_us_fresh_canvas_media_400_v5_noflat_20260820',
  templateLock: {
    status: 'LOCKED_NO_LAYOUT_CHANGES',
    lockId: templateLock.lockId,
    manifest: templateLock,
    assetChecks: templateAssetChecks,
    artworkOnlyVariable: true,
    flatRoleProhibited: true,
  },
  totals: {
    designs: sourceManifest.length,
    files: mediaManifest.length,
    filesystemJpegs: actualFiles.length,
    totalBytes,
    uniqueSha256: uniqueHashes.size,
  },
  designOrientationCounts,
  fileOrientationCounts: orientationCounts,
  roleCounts,
  themeCounts,
  artworkFidelity: {
    comparedFiles: maeValues.length,
    meanAbsoluteErrorAverage: maeValues.reduce((sum, value) => sum + value, 0) / maeValues.length,
    meanAbsoluteErrorMaximum: Math.max(...maeValues),
    threshold: 8,
  },
  mainWhiteBackground: {
    checkedFiles: cornerValues.length,
    cornerAverageMinimum: Math.min(...cornerValues),
    threshold: 242,
  },
  sizeLayout: {
    checkedDesigns: sizeLayoutChecks.length,
    portraitRows: [5, 2],
    landscapeRows: [5, 2],
    labelFontPx: 40,
    labelPlacement: 'independent white badge below each product',
    failures: sizeLayoutChecks.filter((check) => !check.labelsBelowArtwork || !check.labelsClearFooter || check.actualRows.join(',') !== check.expectedRows.join(',')).length,
  },
  contactSheets,
  warnings,
  errors,
};

await fs.writeFile(path.join(PROJECT_ROOT, 'qa_report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const themeRows = Object.entries(themeCounts).sort(([a], [b]) => a.localeCompare(b)).map(([themeCode, value]) =>
  `| ${themeCode} | ${value.themeName} | ${value.portraitDesigns} | ${value.landscapeDesigns} | ${value.designs} | ${value.files} |`,
);
const markdown = [
  '# Media QA Report',
  '',
  `Status: **${report.status}**`,
  '',
  `- Designs: ${report.totals.designs}`,
  `- JPEG files: ${report.totals.files}`,
  `- Unique SHA-256 hashes: ${report.totals.uniqueSha256}`,
  `- Portrait designs/files: ${designOrientationCounts.V23} / ${orientationCounts.V23}`,
  `- Landscape designs/files: ${designOrientationCounts.H32} / ${orientationCounts.H32}`,
  `- Artwork fidelity comparisons: ${report.artworkFidelity.comparedFiles}; maximum MAE ${report.artworkFidelity.meanAbsoluteErrorMaximum.toFixed(3)} (limit ${report.artworkFidelity.threshold})`,
  `- MAIN white-corner minimum: ${report.mainWhiteBackground.cornerAverageMinimum.toFixed(2)} (minimum ${report.mainWhiteBackground.threshold})`,
  '',
  '| Theme | Name | Portrait designs | Landscape designs | Designs | Files |',
  '|---|---|---:|---:|---:|---:|',
  ...themeRows,
  '',
  '## Role counts',
  '',
  ...ROLES.map((role) => `- ${role}: ${roleCounts[role]}`),
  '',
  '## Contact sheets',
  '',
  ...contactSheets.map((filePath) => `- ${path.relative(PROJECT_ROOT, filePath)}`),
  '',
  '## Errors',
  '',
  ...(errors.length === 0 ? ['- None'] : errors.map((error) => `- ${error}`)),
  '',
].join('\n');
await fs.writeFile(path.join(PROJECT_ROOT, 'QA_REPORT.md'), markdown, 'utf8');

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) process.exitCode = 1;
