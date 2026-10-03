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
const hasImages = elements.some(e => e.type !== 'textbox');
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
controls = {}; destroyed = 0; errors = {}; failTemplate = nil
local writable = {name=true, fontSize=true, minimumFontSize=true, adaptiveFontSize=true,
    fontColor=true, bgColor=true, enableOutline=true, outlineColor=true,
    horizontalAlignment=true, verticalAlignment=true, text=true, imageType=true, imageColor=true}
function control(kind)
    local c = {kind=kind, alive=true}
    local values = {fontSize=99, minimumFontSize=98, adaptiveFontSize=false,
        text="template text", enableOutline=false, visible=false, active=false}
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
        end
    end
    return setmetatable(c, {
        __index=values,
        __newindex=function(self, key, value)
            assert(writable[key], "undocumented writable field: " .. key)
            if key == "fontSize" or key == "minimumFontSize" then
                assert(math.type(value) == "integer", "font size must be an integer")
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
        if id == failTemplate then return nil end
        assert(id == 1234 or id == 5678)
        assert(parent == script.object)
        local c = control(id == 5678 and "text" or "image")
        rawset(c, "id", id); table.insert(controls, c); return c
    end,
    DestroyClientUIControl=function(c)
        assert(c.alive); rawset(c, "alive", false); destroyed = destroyed + 1
    end
}
Enum = {ImageSource={StaticReference="static", Prefab="prefab"}, ImageType={Stretch="stretch"},
    TextHorizontalAlignment={Left="left", Middle="center", Right="right"},
    TextVerticalAlignment={Top="top", Middle="middle", Bottom="bottom"}}
Color = {FromRGBA=function(...) return {...} end}
printerr = function(message) table.insert(errors, message) end
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
run(`OnStart(); assert(#controls == ${elements.length} and #errors == 0)`);
for (const [i, element] of elements.entries()) {
  const c = `controls[${i + 1}]`;
  run(`assert(${c}.top and ${c}.alive)`);
  if (element.type !== 'textbox') {
    run(`assert(${c}.id == 1234 and ${c}.asset == ${element.prefabId ?? element.imageAssetId ?? assets[element.type]})`);
    run(`assert(${c}.source == ${quote(element.type === 'prefab' ? 'prefab' : 'static')})`);
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
    SetLocalScaleValue:[box.scaleX, box.scaleY, 1], SetLocalRotationValue:[0, 0, element.rotation],
  };
  for (const [field, color, opacity] of [['fontColor',box.textColor,box.textOpacity],
    ['bgColor',box.bgColor,box.bgOpacity], ['outlineColor',box.outlineColor,box.outlineOpacity]]) {
    vectors[field] = [1,3,5].map(offset => parseInt(color.slice(offset,offset+2),16)).concat(Math.floor(opacity * 255));
  }
  for (const [field, vector] of Object.entries(vectors)) {
    vector.forEach((value,j) => run(`assert(math.abs(${c}.${field}[${j+1}] - (${value})) < 0.000001, ${quote(field)})`));
  }
}
run(`OnStart(); assert(destroyed == ${elements.length} and #errors == 0); OnDestroy(); assert(destroyed == ${elements.length * 2})`);
const fail = vm(configured);
const beforeText = elements.findIndex(e => e.type === 'textbox');
fail(`failTemplate = 5678; OnStart(); assert(#controls == ${beforeText} and destroyed == ${beforeText} and #errors == 1)`);
fail(`OnDestroy(); assert(destroyed == ${beforeText})`);
vm(configured)('script.object = nil; OnStart(); assert(#controls == 0 and #errors == 0)');
console.log(`PASS: ${elements.length} controls; textbox styles, integer sizes, adaptive sizing, mixed stacking, missing bindings and cleanup`);
