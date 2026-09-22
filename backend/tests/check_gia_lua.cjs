// Usage: node check_gia_lua.cjs <fengari module path> <script.lua> <scene.json>
// Offline VM check: every exported field, explicit stacking, binding failure and lifecycle.
const fs = require('fs');
const {lua, lauxlib, lualib, to_luastring, to_jsstring} = require(process.argv[2]);
const scene = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const source = fs.readFileSync(process.argv[3], 'utf8');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
function run(code) {
  if (lauxlib.luaL_dostring(L, to_luastring(code)) !== lua.LUA_OK) {
    throw Error(to_jsstring(lua.lua_tostring(L, -1)));
  }
}
run(`
controls = {}; destroyed = 0; errors = 0
function recorder(name)
    return function(self, ...) self[name] = {...} end
end
function control()
    local c = {}
    for _, name in ipairs({'SetAnchorMin','SetAnchorMax','SetPivot','SetSizeDelta','SetLocalScale','SetLocalRotation','SetAnchoredPosition'}) do
        c[name] = recorder(name .. 'Value')
    end
    c.SetImage = function(self, source, asset) assert(source == "static"); self.asset=asset end
    c.SetAsLastSibling = function(self) self.top = true end
    return c
end
script = {object=control()}
game = {
    InstantiateClientUIControl = function(id, parent)
        local c = control(); c.id=id; c.parent=parent
        table.insert(controls,c); return c
    end,
    DestroyClientUIControl = function(c) assert(not c.destroyed); c.destroyed=true; destroyed=destroyed+1 end
}
Enum = {ImageSource={StaticReference="static"}, ImageType={Stretch="stretch"}}
Color = {FromRGBA=function(...) return {...} end}
printerr = function(message) errors=errors+1 end
`);
run(source);
run('OnStart(); assert(#controls == 0 and errors == 1)');
// One template must serve every static image asset.
run(source.replace('local IMAGE_PREFAB_ID = 0', 'local IMAGE_PREFAB_ID = 1234'));
run(`OnStart(); assert(#controls == ${scene.records.length}); assert(errors == 1)`);
for (let i = 0; i < scene.records.length; i++) {
  const r = scene.records[i];
  const checks = {SetAnchoredPositionValue:r.slice(1,3),SetSizeDeltaValue:r.slice(3,5),
    SetPivotValue:r.slice(5,7),SetAnchorMinValue:r.slice(7,9),SetAnchorMaxValue:r.slice(9,11),
    SetLocalScaleValue:[...r.slice(11,13),1],SetLocalRotationValue:[0,0,r[13]],imageColor:r.slice(14,18)};
  run(`assert(controls[${i+1}].id == 1234 and controls[${i+1}].asset == ${r[0]} and controls[${i+1}].top)`);
  for (const [key, values] of Object.entries(checks)) {
    values.forEach((value,j) => run(`assert(math.abs(controls[${i+1}].${key}[${j+1}] - (${value})) < 0.000001)`));
  }
}
run(`OnStart(); assert(destroyed == ${scene.records.length}); OnDestroy(); assert(destroyed == ${scene.records.length*2})`);
console.log(`PASS: ${scene.records.length} images, geometry/RGBA/pivots/mirrors/order, missing bindings, restart and cleanup`);
