import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('mask assets share same-origin loads and retries notify all mounted previews', async () => {
  const originalImage = globalThis.Image, originalWindow = globalThis.window;
  const images = [];
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.Image = class { constructor() { images.push(this); } };
  const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
  const library = moduleUrl(`export const assetMaskUrl=id=>'/api/library/sprite/'+id+'.png'; export const loadSpriteMeta=async id=>({id});`);
  const source = ts.transpileModule(readFileSync(new URL('../src/maskAssets.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
  }).outputText.replace('"./imageLibrary"', JSON.stringify(library));
  try {
    const { loadMaskAsset, subscribeMaskAssets } = await import(moduleUrl(source));
    const notices = [];
    const unsubscribe = subscribeMaskAssets((id, asset) => notices.push([id, asset]));
    const first = loadMaskAsset(106030), second = loadMaskAsset(106030);
    assert.equal(first, second);
    assert.equal(images.length, 1);
    assert.equal(images[0].src, '/api/library/sprite/106030.png');
    images[0].onload();
    const asset = await first;
    assert.equal(asset.image, images[0]);
    assert.equal(asset.metadata.id, 106030);
    assert.equal(notices.length, 1);
    assert.equal(await loadMaskAsset(106030), asset);
    const failed = loadMaskAsset(107075);
    images[1].onerror();
    await assert.rejects(failed, /unavailable/);
    const retry = loadMaskAsset(107075);
    assert.equal(images.length, 3);
    images[2].onload();
    await retry;
    assert.deepEqual(notices.map(([id]) => id), [106030, 107075]);
    unsubscribe();
    const later = loadMaskAsset(100007);
    images[3].onload();
    await later;
    assert.equal(notices.length, 2);
  } finally { globalThis.Image = originalImage; globalThis.window = originalWindow; }
});
