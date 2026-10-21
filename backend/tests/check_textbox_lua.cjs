// Usage: node check_textbox_lua.cjs <fengari module path> <script.lua> <scene.json>
// Client UI API contract check, not a device rendering test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {lua, lauxlib, lualib, to_luastring, to_jsstring} = require(process.argv[2]);
const source = fs.readFileSync(process.argv[3], 'utf8');
const scene = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const assets = {rectangle:100001, ellipse:100002, triangle:100003,
  four_point_star:100004, five_point_star:100005, ring:100006};
const elements = scene.elements.filter(e => e.type === 'textbox' || e.type === 'image' ||
  e.type === 'prefab' || assets[e.type]).sort((a,b) => Number(b.isBackground) - Number(a.isBackground) || a.zIndex - b.zIndex);
assert(elements.some(e => e.type === 'textbox'), 'This checker requires textboxes');
const activeMask = e => e.luaMask && (e.luaMask.enabled || e.luaMask.enableSoftEdge);
const hasMaskData = elements.some(e => e.luaMask);
const maskCount = elements.filter(activeMask).length;
const hasImages = elements.some(e => e.type !== 'textbox') || maskCount > 0;
const controlCount = elements.length + maskCount;
const maskSlots = [];
let nextSlot = 1;
for (const element of elements) {
  if (activeMask(element)) maskSlots.push({ index: nextSlot++, cfg: element.luaMask });
  nextSlot++;
}
const typedMasks = maskSlots.filter(({ cfg }) => cfg.imageType != null);
const quote = value => '"' + value.replace(/[\x00-\x1f\x7f\\"]/g, char =>
  char === '\\' || char === '"' ? '\\' + char : '\\' + char.charCodeAt(0).toString().padStart(3,'0')) + '"';
const literal = value => typeof value === 'string' ? quote(value) : String(value);

function vm(script) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const run = code => {
    if (lauxlib.luaL_dostring(L, to_luastring(code)) !== lua.LUA_OK) {
      throw Error(to_jsstring(lua.lua_tostring(L, -1)));
    }
  };
  run(`
controls = {}; destroyed = 0; errors = {}; notices = {}; failTemplate = nil; reenter = false
maskTypeWrites = 0; maskTypeBehavior = nil
local maskSlots = {${maskSlots.map(({ index }) => `[${index}]=true`).join(',')}}
local writable = {name=true, fontSize=true, minimumFontSize=true, adaptiveFontSize=true,
    fontColor=true, bgColor=true, enableOutline=true, outlineColor=true,
    horizontalAlignment=true, verticalAlignment=true, text=true, imageType=true, imageColor=true,
    enableMask=true, enableSoftEdge=true, reverseMaskArea=true, softEdgeMode=true,
    softEdgeWidthX=true, softEdgeWidthY=true, horizontalSoftRange=true, verticalSoftRange=true}
function control(kind)
    local c = {kind=kind, alive=true}
    local values = {fontSize=99, minimumFontSize=98, adaptiveFontSize=false,
        text="template text", enableOutline=false, visible=false, active=false, imageType="basic"}
    for _, method in ipairs({'SetAnchorMin','SetAnchorMax','SetPivot','SetSizeDelta','SetLocalScale','SetLocalRotation','SetAnchoredPosition'}) do
        c[method] = function(self, ...) values[method .. 'Value'] = {...} end
    end
    c.SetAsLastSibling = function(self) values.top = true end
    c.SetActive = function(self, value) values.active = value end
    c.SetVisible = function(self, value) values.visible = value end
    if kind == "image" then
        c.SetImage = function(self, source, asset)
            assert(source == "static" or source == "prefab")
            assert(math.type(asset) == "integer")
            values.source = source; values.asset = asset
            values.imageSource = source; values.imageId = asset
        end
        c.SetFillUnused = function(self) values.fillType = 'Unused' end
        c.SetSoftEdgeWidth = function(self, x, y) values.softEdgeWidthX=x; values.softEdgeWidthY=y end
    end
    return setmetatable(c, {
        __index=values,
        __newindex=function(self, key, value)
            assert(writable[key], "undocumented writable field: " .. key)
            if key == "fontSize" or key == "minimumFontSize" then
                assert(math.type(value) == "integer", "font size must be an integer")
            elseif key == "imageType" and self.testMask then
                assert(values.imageSource == "static" and not values.visible, "mask type must be set after binding, before showing")
                assert(value == "basic" or value == "stretch", "mask type must use a native enum")
                maskTypeWrites = maskTypeWrites + 1
                if maskTypeBehavior == "reject" then error("imageType: no such field") end
                if maskTypeBehavior == "ignore" then values.imageType = "unchanged"; return end
            elseif key == "adaptiveFontSize" or key == "enableOutline" then
                assert(type(value) == "boolean")
            end
            values[key] = value
        end
    })
end
script = {object=control("parent")}
game = {
    InstantiateClientUIControl=function(id, parent)
        if reenter then reenter = false; OnStart() end
        if id == failTemplate then return nil end
        assert(id == 1234 or id == 5678)
        assert(parent == script.object or (parent.kind == 'image' and parent.enableMask))
        local c = control(id == 5678 and "text" or "image")
        rawset(c, 'testMask', maskSlots[(#controls % ${controlCount || 1})+1] == true)
        rawset(c, 'parent', parent)
        rawset(c, "id", id); table.insert(controls, c); return c
    end,
    DestroyClientUIControl=function(c)
        assert(c.alive); rawset(c, "alive", false); destroyed = destroyed + 1
    end
}
Enum = {ImageSource={StaticReference="static", Prefab="prefab"}, ImageType={Basic="basic", Stretch="stretch"},
    ImageMaskSoftEdgeMode={Pixel="Pixel", Percentage="Percentage"},
    TextHorizontalAlignment={Left="left", Middle="center", Right="right"},
    TextVerticalAlignment={Top="top", Middle="middle", Bottom="bottom"}}
Color = {FromRGBA=function(...) return {...} end}
printerr = function(message) table.insert(errors, message) end
print = function(message) table.insert(notices, message) end
`);
  run(script);
  return run;
}

vm(source)('OnStart(); assert(#controls == 0 and #errors == 1)');
const configured = source.replace('local TEXTBOX_PREFAB_ID = 0', 'local TEXTBOX_PREFAB_ID = 5678')
  .replace('local IMAGE_PREFAB_ID = 0', `local IMAGE_PREFAB_ID = ${hasImages ? 1234 : 0}`);
// Both bindings are checked before any partial drawing is created.
if (hasImages) {
  vm(source.replace('local IMAGE_PREFAB_ID = 0', 'local IMAGE_PREFAB_ID = 1234'))(
    'OnStart(); assert(#controls == 0 and #errors == 1)');
  vm(source.replace('local TEXTBOX_PREFAB_ID = 0', 'local TEXTBOX_PREFAB_ID = 5678'))(
    'OnStart(); assert(#controls == 0 and #errors == 1)');
}
const run = vm(configured);
if (hasMaskData) run('reenter = true');
run(`OnStart(); assert(#controls == ${controlCount} and #errors == 0, table.concat(errors, '|'))`);
run(`assert(maskTypeWrites == ${typedMasks.length} and #notices == 0)`);
let controlIndex = 0;
for (const [i, element] of elements.entries()) {
  const maskIndex = activeMask(element) ? ++controlIndex : null;
  const c = `controls[${++controlIndex}]`;
  if (maskIndex) {
    const m = `controls[${maskIndex}]`, cfg = element.luaMask;
    run(`assert(${c}.parent == ${m} and ${m}.parent == script.object)`);
    run(`assert(${m}.enableMask and ${m}.visible and ${m}.active and ${m}.imageColor[4] == 0)`);
    run(`assert(${m}.source == 'static' and ${m}.asset == ${cfg.imageId ?? 100001} and ${m}.fillType == 'Unused')`);
    run(`assert(${m}.imageType == ${quote(cfg.imageType ?? 'basic')})`);
    for (const key of ['enableSoftEdge','reverseMaskArea','softEdgeMode','softEdgeWidthX','softEdgeWidthY','horizontalSoftRange','verticalSoftRange']) {
      run(`assert(${m}.${key} == ${literal(cfg[key])}, ${quote(key)})`);
    }
    // Actual child anchors/size/offset must solve to the exact same untransformed
    // rect as the old direct-to-host layout, including stretch and noncentral pivot.
    if (element.type === 'textbox') {
      const b = element.textBox, W = scene.canvas.width, H = scene.canvas.height;
      const mw = cfg.width ?? Math.abs((element.width + W*(b.anchorMaxX-b.anchorMinX))*b.scaleX);
      const mh = cfg.height ?? Math.abs((element.height + H*(b.anchorMaxY-b.anchorMinY))*b.scaleY);
      run(`assert(math.abs(${m}.SetSizeDeltaValue[1]-${mw})<0.0001 and math.abs(${m}.SetSizeDeltaValue[2]-${mh})<0.0001)`);
      const ex = element.x-W/2, ey = H/2-element.y;
      run(`local c,m=${c},${m}
local mw,mh=m.SetSizeDeltaValue[1],m.SetSizeDeltaValue[2]
assert(math.abs(c.SetSizeDeltaValue[1]+mw*(${b.anchorMaxX}-${b.anchorMinX})-(${element.width}+${W}*(${b.anchorMaxX}-${b.anchorMinX})))<0.0001)
assert(math.abs(c.SetSizeDeltaValue[2]+mh*(${b.anchorMaxY}-${b.anchorMinY})-(${element.height}+${H}*(${b.anchorMaxY}-${b.anchorMinY})))<0.0001)
assert(math.abs(m.SetAnchoredPositionValue[1]+c.SetAnchoredPositionValue[1]+mw*(${b.anchorMinX}+(${b.anchorMaxX}-${b.anchorMinX})*${b.pivotX}-.5)-(${ex}+${W}*(${b.anchorMinX}+(${b.anchorMaxX}-${b.anchorMinX})*${b.pivotX}-.5)))<0.0001)
assert(math.abs(m.SetAnchoredPositionValue[2]+c.SetAnchoredPositionValue[2]+mh*(${b.anchorMinY}+(${b.anchorMaxY}-${b.anchorMinY})*${b.pivotY}-.5)-(${ey}+${H}*(${b.anchorMinY}+(${b.anchorMaxY}-${b.anchorMinY})*${b.pivotY}-.5)))<0.0001)`);
    } else {
      run(`assert(${m}.SetSizeDeltaValue[1] == ${cfg.width ?? element.width} and ${m}.SetSizeDeltaValue[2] == ${cfg.height ?? element.height})`);
      run(`assert(math.abs(${m}.SetAnchoredPositionValue[1] - (${element.x-scene.canvas.width/2+cfg.offsetX}))<0.0001)`);
      run(`assert(math.abs(${m}.SetAnchoredPositionValue[2] - (${scene.canvas.height/2-element.y-cfg.offsetY}))<0.0001)`);
    }
  } else run(`assert(${c}.parent == script.object)`);
  run(`assert(${c}.top and ${c}.alive)`);
  [element.rotationX ?? 0, element.rotationY ?? 0, element.rotation].forEach((value, j) =>
    run(`assert(math.abs(${c}.SetLocalRotationValue[${j + 1}] - (${value})) < 0.0001, "rotation axis ${j}")`));
  if (element.type !== 'textbox') {
    run(`assert(${c}.id == 1234 and ${c}.asset == ${element.prefabId ?? element.imageAssetId ?? assets[element.type]})`);
    run(`assert(${c}.source == ${quote(element.type === 'prefab' ? 'prefab' : 'static')})`);
    if (element.type === 'image') run(`assert(${c}.imageType == ${quote(element.imageType ?? 'basic')})`);
    continue;
  }
  const box = element.textBox;
  run(`assert(${c}.id == 5678 and ${c}.active and ${c}.visible == ${box.visible})`);
  for (const [key, value] of Object.entries({name:element.name, text:box.text, fontSize:box.fontSize,
    minimumFontSize:box.minFontSize, adaptiveFontSize:box.autoSize, enableOutline:box.outlineEnabled,
    horizontalAlignment:box.alignH, verticalAlignment:box.alignV})) {
    run(`assert(${c}.${key} == ${literal(value)}, ${quote(key)})`);
  }
  const vectors = {
    SetAnchoredPositionValue:[element.x - scene.canvas.width / 2, scene.canvas.height / 2 - element.y],
    SetSizeDeltaValue:[element.width, element.height], SetPivotValue:[box.pivotX, box.pivotY],
    SetAnchorMinValue:[box.anchorMinX, box.anchorMinY], SetAnchorMaxValue:[box.anchorMaxX, box.anchorMaxY],
    SetLocalScaleValue:[box.scaleX, box.scaleY, 1], SetLocalRotationValue:[element.rotationX ?? 0, element.rotationY ?? 0, element.rotation],
  };
  if (maskIndex) { delete vectors.SetAnchoredPositionValue; delete vectors.SetSizeDeltaValue; }
  for (const [field, color, opacity] of [['fontColor',box.textColor,box.textOpacity],
    ['bgColor',box.bgColor,box.bgOpacity], ['outlineColor',box.outlineColor,box.outlineOpacity]]) {
    vectors[field] = [1,3,5].map(offset => parseInt(color.slice(offset,offset+2),16)).concat(Math.floor(opacity * 255));
  }
  for (const [field, vector] of Object.entries(vectors)) {
    vector.forEach((value,j) => run(`assert(math.abs(${c}.${field}[${j+1}] - (${value})) < 0.000001, ${quote(field)})`));
  }
}
run(`OnStart(); assert(destroyed == ${controlCount} and #errors == 0); OnDestroy(); assert(destroyed == ${hasMaskData ? controlCount : controlCount * 2})`);
if (typedMasks.length) {
  const warningCount = new Set(typedMasks.map(({ cfg }) => `${cfg.imageId ?? 100001}:${cfg.imageType}`)).size;
  for (const behavior of ['reject', 'ignore']) {
    const fallback = vm(configured);
    fallback(`maskTypeBehavior = ${quote(behavior)}; OnStart(); assert(#controls == ${controlCount} and #errors == 0)`);
    fallback(`assert(maskTypeWrites == ${typedMasks.length} and #notices == ${warningCount})`);
    for (const { index } of maskSlots) fallback(`assert(controls[${index}].enableMask and controls[${index}].visible and controls[${index}].alive)`);
    for (const { index } of typedMasks) fallback(`assert(controls[${index}].imageType == ${quote(behavior === 'reject' ? 'basic' : 'unchanged')})`);
    fallback(`OnStart(); assert(maskTypeWrites == ${typedMasks.length * 2} and #notices == ${warningCount} and #errors == 0 and destroyed == ${controlCount})`);
    fallback(`OnDestroy(); assert(destroyed == ${controlCount})`);
  }
}
const fail = vm(configured);
const textIndex = elements.findIndex(e => e.type === 'textbox');
const beforeText = textIndex + elements.slice(0,textIndex+1).filter(activeMask).length;
fail(`failTemplate = 5678; OnStart(); assert(#controls == ${beforeText} and destroyed == ${beforeText} and #errors == 1)`);
fail(`OnDestroy(); assert(destroyed == ${beforeText})`);
vm(configured)('script.object = nil; OnStart(); assert(#controls == 0 and #errors == 0)');
console.log(`PASS: ${elements.length} controls; textbox styles, integer sizes, adaptive sizing, mixed stacking, missing bindings and cleanup`);
