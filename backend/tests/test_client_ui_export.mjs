// 可选独立编解码校验；由 test_client_ui_export.py 在设置 UGC_GIA_CODEC 后调用。
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const { decode, encode } = await import(pathToFileURL(process.argv[2]).href);
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const meta = unit => unit["19"]["1"];
const component = (unit, tag) => list(meta(unit)["505"]).find(part => String(tag) in part)?.["503"]?.[String(tag + 1)];
const platforms = unit => list(list(meta(unit)["505"]).find(part => "11" in part)?.["503"]?.["13"]?.["12"]?.["501"]);
// 与 ugc-tool 的 prepareEncoding 一致：dtype 收敛为 string 后仍可能带 base64 文本。
function normalizeStrings(document) {
  const types = new Map(document.dtype_csv.split(/\r?\n/).map(line => {
    const [path, , type] = line.split(","); return [path, type];
  }));
  function visit(owner, path = "") {
    for (const [key, value] of Object.entries(owner)) {
      const field = path ? `${path}/${key}` : key;
      const convert = item => {
        if (types.get(field) === "string" && typeof item === "string" && item.startsWith("base64:")) {
          return `string:${Buffer.from(item.slice(7), "base64").toString("utf8")}`;
        }
        if (item && typeof item === "object") visit(item, field);
        return item;
      };
      owner[key] = Array.isArray(value) ? value.map(convert) : convert(value);
    }
  }
  visit(document.json);
  return document;
}

for (const filename of process.argv.slice(3)) {
  const document = decode(fs.readFileSync(filename), { type: "gia" });
  const source = JSON.parse(fs.readFileSync(filename.replace(/\.gia$/, ".json"), "utf8"));
  const masked = source.canvas.mask.enabled, offset = masked ? 2 : 1;
  const primary = document.json["1"], units = [primary, ...list(document.json["2"])];
  assert.equal(primary["5"], 70, "根资产必须是客户端控件模板，不是服务端 UI 组");
  assert.equal(units.length, source.elements.length + offset);
  assert.equal(component(primary, 72), undefined, "不能生成服务端根节点引用包装层");
  assert.ok(component(units[0], 78));
  const indices = [];
  for (const unit of units) {
    const id = unit["1"]["4"];
    assert.equal(unit["1"]["2"], 1); assert.equal(unit["1"]["3"], 8);
    assert.equal(meta(unit)["501"], id);
    assert.equal(list(meta(unit)["502"])[0]["11"]["501"], id);
    indices.push(list(meta(unit)["502"])[1]["12"]["501"]);
    assert.equal(unit["5"], unit === primary ? 70 : 15);
    for (const part of list(meta(unit)["505"])) {
      if (part["503"]) assert.equal(part["503"]["504"]["4"], id);
    }
    const devices = platforms(unit);
    assert.deepEqual(devices.map(p => p["501"] ?? 0), [0, 1, 2, 3]);
    for (const p of devices) assert.deepEqual(p["502"], devices[0]["502"]);
  }
  assert.equal(new Set(indices).size, units.length, "新建控件资产编号必须互相独立");
  const rootLayout = platforms(primary)[0]["502"];
  assert.deepEqual(rootLayout["505"], { "501": source.canvas.width, "502": source.canvas.height });
  if (masked) {
    assert.equal(component(units[1], 83)["502"], 0x00ffffff);
    assert.equal(component(units[1], 84)["501"], 1);
  }
  const parent = masked ? units[1] : units[0];
  const images = units.slice(offset);
  assert.deepEqual(list(parent["2"]).map(ref => ref["4"]), images.map(unit => unit["1"]["4"]));
  assert.deepEqual(images.map(unit => component(unit, 83)["503"]), [100001, 100002, 100003]);
  assert.deepEqual(images.map(unit => component(unit, 83)["502"] >>> 0), [0xffffffff, 0x80123456, 0x00abcdef]);
  const px = masked ? source.canvas.mask.x : 0, py = masked ? source.canvas.mask.y : 0;
  for (const [index, unit] of images.entries()) {
    assert.equal(meta(unit)["504"], parent["1"]["4"]);
    assert.equal(component(unit, 83)["504"], 1);
    assert.equal(component(unit, 84)["501"] ?? 0, 0);
    const rect = platforms(unit)[0]["502"], expected = source.elements[index];
    assert.ok(Math.abs((rect["504"]["501"] ?? 0) - (expected.x - source.canvas.width / 2 - px)) < 1e-4);
    assert.ok(Math.abs((rect["504"]["502"] ?? 0) - (source.canvas.height / 2 - expected.y - py)) < 1e-4);
    assert.ok(Math.abs((rect["505"]["501"] ?? 0) - expected.width) < 1e-4);
    assert.ok(Math.abs((rect["505"]["502"] ?? 0) - expected.height) < 1e-4);
  }
  const ellipse = platforms(images[1])[0]["502"], triangle = platforms(images[2])[0]["502"];
  assert.deepEqual(ellipse["508"], { "1": 5, "2": 90, "3": 30 });
  assert.equal(triangle["508"]["3"], 45);
  normalizeStrings(document);
  assert.deepEqual(normalizeStrings(decode(encode(document, { type: "gia" }), { type: "gia" })).json, document.json);
  const canonical = encode(document, { type: "gia" });
  assert.deepEqual(encode(normalizeStrings(decode(canonical, { type: "gia" })), { type: "gia" }), canonical);
  console.log(`PASS independent ugc-tool codec: client container-node template(70), mask=${masked}, asset indices, four layouts, geometry, ARGB and stable round-trip`);
}
