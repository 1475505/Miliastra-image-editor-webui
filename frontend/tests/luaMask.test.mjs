import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const js = ts.transpileModule(readFileSync(new URL('../src/luaMask.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const { luaMaskOf, luaMaskActive, parseLuaMaskPatch, scaleLuaMask } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const previewJs = transpile('../src/maskPreview.ts').replace('"./luaMask"', JSON.stringify(asModule(js)))
  .replace('"./rotation"', JSON.stringify(asModule(transpile('../src/rotation.ts'))));
const { previewCoverage, previewFeatherWidths, previewMaskSupported, maskPreviewBounds } = await import(asModule(previewJs));

test('mask mode changes preserve all raw values; feather-only enables the Lua gate', () => {
  const original = luaMaskOf({ softEdgeWidthX: 13.5, horizontalSoftRange: 81, width: 0 });
  const percent = luaMaskOf({ ...original, softEdgeMode: 'Percentage', enableSoftEdge: true });
  assert.equal(percent.softEdgeWidthX, 13.5);
  assert.equal(percent.horizontalSoftRange, 81);
  assert.equal(percent.width, 0);
  assert.equal(luaMaskActive(percent), true);
  assert.equal(luaMaskActive(original), false);
  assert.equal(scaleLuaMask(percent, 2).softEdgeWidthX, 13.5);
  assert.equal(scaleLuaMask(original, 2).softEdgeWidthX, 27);
  assert.equal(scaleLuaMask(original, 2).height, null);
});

test('mask image defaults to the rectangle and custom IDs survive edits and scaling', () => {
  assert.equal(luaMaskOf().imageId, 100001);
  assert.equal(luaMaskOf({ enabled: true }).imageId, 100001);
  const custom = luaMaskOf({ imageId: 100002, enabled: true, softEdgeMode: 'Percentage' });
  assert.equal(scaleLuaMask(custom, 2).imageId, 100002);
  assert.equal(luaMaskOf({ ...custom, softEdgeMode: 'Pixel' }).imageId, 100002);
  assert.equal(previewMaskSupported(custom), false, 'unverified custom contour must not be shown as a rectangle');
  assert.equal(previewMaskSupported({ enabled: true }), true, 'legacy settings still preview');
  assert.equal(previewMaskSupported({ ...custom, imageId: 100001 }), true, 'returning to default restores preview');
  for (const imageId of [0, -1, 1.5, NaN, Infinity, true, null, '100002', 2147483648]) {
    assert.throws(() => parseLuaMaskPatch({ imageId }));
  }
  assert.deepEqual(parseLuaMaskPatch({ imageId: 2147483647 }), { imageId: 2147483647 });
});

test('mask patches reject unknown keys, nonfinite values and invalid enums', () => {
  for (const value of [[], true, {width:-1}, {enabled:1}, {offsetY:Infinity},
    {softEdgeMode:'pixel'}, {softEdgeWidthX:'20'}, {constructor:1}]) assert.throws(() => parseLuaMaskPatch(value));
  assert.equal(parseLuaMaskPatch(null), null);
});

test('mask image type keeps legacy defaults and preserves explicit choices independently', () => {
  assert.equal(luaMaskOf().imageType, null);
  assert.equal(luaMaskOf({ imageId: 106030 }).imageType, null);
  const basic = luaMaskOf({ imageId: 106030, imageType: 'basic', width: 220, softEdgeWidthX: 20 });
  const stretch = luaMaskOf({ ...basic, ...parseLuaMaskPatch({ imageType: 'stretch' }) });
  assert.equal(stretch.imageId, 106030);
  assert.equal(stretch.width, 220);
  assert.equal(stretch.softEdgeWidthX, 20);
  assert.equal(scaleLuaMask(stretch, 2).imageType, 'stretch');
  assert.equal(luaMaskOf({ ...stretch, imageId: 100001 }).imageType, 'stretch');
  assert.equal(luaMaskOf({ ...stretch, imageType: null }).imageType, null);
  for (const imageType of ['Basic', 'Stretch', 'auto', '', 0, true, []]) {
    assert.throws(() => parseLuaMaskPatch({ imageType }));
  }
  for (const imageType of ['basic', 'stretch', null]) {
    assert.equal(previewMaskSupported({ enabled: true, imageId: 100001, imageType }), true);
    assert.equal(previewMaskSupported({ enabled: true, imageId: 106030, imageType }), false);
  }
});

test('Pixel preview clips and feathers against the axis-aligned mask, without modifying raw settings', () => {
  const mask = luaMaskOf({ enabled: true, enableSoftEdge: true, softEdgeWidthX: 20, softEdgeWidthY: 10 });
  assert.equal(previewCoverage(0, 0, mask, 100, 60), 1);
  assert.equal(previewCoverage(-40, 0, mask, 100, 60), .5);
  assert.equal(previewCoverage(40, 25, mask, 100, 60), .5);
  assert.equal(previewCoverage(51, 0, mask, 100, 60), 0);
  assert.equal(previewCoverage(0, 0, mask, 0, 60), 0);
  const offset = { ...mask, offsetX: 20, enableSoftEdge: false };
  assert.equal(previewCoverage(-31, 0, offset, 100, 60), 0);
  assert.equal(previewCoverage(-29, 0, offset, 100, 60), 1);
  assert.equal(previewMaskSupported(mask), true);
  assert.equal(previewMaskSupported({ ...mask, softEdgeMode: 'Percentage' }), true);
  assert.equal(previewMaskSupported({ ...mask, reverseMaskArea: true }), false);
  assert.equal(previewMaskSupported(null), false);
  assert.equal(mask.softEdgeWidthX, 20);
});

test('Percentage preview uses separate horizontal/vertical opaque spans and scales with mask size', () => {
  const mask = luaMaskOf({ enableSoftEdge: true, softEdgeMode: 'Percentage',
    horizontalSoftRange: 80, verticalSoftRange: 60, softEdgeWidthX: 999, softEdgeWidthY: 888 });
  // 200-wide with 80% opaque: each transition is 20. 100-high at 60%: also 20.
  const widths = previewFeatherWidths(mask, 200, 100);
  assert.ok(Math.abs(widths.x - 20) < 1e-10);
  assert.equal(widths.y, 20);
  assert.ok(Math.abs(previewCoverage(90, 0, mask, 200, 100) - .5) < 1e-10);
  assert.equal(previewCoverage(0, 40, mask, 200, 100), .5);
  assert.equal(previewCoverage(0, 0, mask, 200, 100), 1);
  assert.equal(previewCoverage(101, 0, mask, 200, 100), 0);
  assert.ok(Math.abs(previewCoverage(180, 0, mask, 400, 200) - .5) < 1e-10);
  assert.equal(previewCoverage(0, 80, mask, 400, 200), .5);
  const wideFade = { ...mask, horizontalSoftRange: 60 };
  assert.equal(previewCoverage(90, 0, wideFade, 200, 100), .25);
  assert.equal(mask.softEdgeWidthX, 999, 'inactive pixel width is preserved');
  assert.equal(mask.softEdgeWidthY, 888);
});

test('Percentage preview handles 0/100, empty masks and out-of-range inputs without altering saved values', () => {
  const mask = luaMaskOf({ enabled: true, enableSoftEdge: true, softEdgeMode: 'Percentage',
    horizontalSoftRange: 100, verticalSoftRange: 100 });
  assert.equal(previewCoverage(99, 49, mask, 200, 100), 1, '100% remains hard');
  assert.equal(previewCoverage(100, 0, mask, 200, 100), 0);
  assert.equal(previewCoverage(50, 0, { ...mask, horizontalSoftRange: 0 }, 200, 100), .5);
  assert.equal(previewCoverage(0, 0, mask, 0, 100), 0);
  const outside = { ...mask, horizontalSoftRange: -20, verticalSoftRange: 150 };
  assert.equal(previewCoverage(50, 49, outside, 200, 100), .5);
  assert.equal(outside.horizontalSoftRange, -20);
  assert.equal(outside.verticalSoftRange, 150);
  assert.equal(previewCoverage(99, 49, { ...outside, enableSoftEdge: false }, 200, 100), 1);
  const pixel = { ...outside, softEdgeMode: 'Pixel', softEdgeWidthX: 20 };
  assert.equal(previewCoverage(90, 49, pixel, 200, 100), .5, 'Pixel ignores preserved Percentage ranges');
});

test('preview buffers contain projected/scaled visuals without rotating the mask itself', () => {
  assert.deepEqual(maskPreviewBounds({ width: 100, height: 60, rotation: 90 }),
    { width: 64, height: 104, contentWidth: 100, contentHeight: 60 });
  assert.deepEqual(maskPreviewBounds({ width: 100, height: 60, rotation: 0, type: 'textbox', textBox: { scaleX: 2, scaleY: .5 } }),
    { width: 204, height: 34, contentWidth: 200, contentHeight: 30 });
  const rotated = maskPreviewBounds({ width: 100, height: 100, rotation: 45 });
  assert.ok(rotated.width >= 142 && rotated.height >= 142, 'rotated corners remain inside the visual buffer');
});
