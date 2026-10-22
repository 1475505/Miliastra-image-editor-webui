import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`,import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext}
}).outputText;
const {clickSelection,selectionRect,selectionBounds,intersectsSelection,translateSelection,reorderSelection,cloneSelection}=
  await import(moduleUrl(compile('editorSelection').replace('"./rotation"',JSON.stringify(moduleUrl(compile('rotation'))))));
const shape=(id,x=50,y=50)=>({id,type:'rectangle',x,y,width:20,height:10,rotation:0,zIndex:0});

test('modifier selection toggles and layer ranges use a stable anchor',()=>{
  const order=['d','c','b','a'];
  assert.deepEqual(clickSelection(['a'],'b',true,false,order,'a'),['a','b']);
  assert.deepEqual(clickSelection(['a','b'],'a',true,false,order,'a'),['b']);
  assert.deepEqual(clickSelection(['a'],'c',false,true,order,'a'),['c','b','a']);
  assert.deepEqual(clickSelection(['a'],'c',true,true,order,'d'),['a','d','c']);
  assert.deepEqual(clickSelection(['a'],'b',false,false,order,'a'),['b']);
});

test('marquee direction is normalized and rotated geometry avoids AABB false positives',()=>{
  assert.deepEqual(selectionRect({x:60,y:70},{x:20,y:15}),{x:20,y:15,width:40,height:55});
  const rotated={...shape('r',50,50),width:100,height:10,rotation:45};
  assert.equal(intersectsSelection(rotated,{x:45,y:45,width:10,height:10}),true);
  assert.equal(intersectsSelection(rotated,{x:78,y:78,width:2,height:2}),false);
  assert.equal(intersectsSelection({...shape('edge'),rotationY:90},{x:49,y:44,width:2,height:12}),true);
});

test('selection bounds include text scale and projected rotations',()=>{
  assert.equal(selectionBounds([]),null);
  assert.deepEqual(selectionBounds([{...shape('text'),type:'textbox',textBox:{scaleX:2,scaleY:3}}]),{x:30,y:35,width:40,height:30});
  assert.deepEqual(selectionBounds([{...shape('r'),rotation:90}]),{x:45,y:40,width:10,height:20});
});

test('batch translation clamps one common delta without squashing spacing',()=>{
  const source=[shape('a',2,20),shape('b',92,50),shape('other',50,90)];
  const next=translateSelection(source,['a','b'],-10,10,{width:100,height:100});
  assert.deepEqual(next.map(e=>[e.x,e.y]),[[0,30],[90,60],[50,90]]);
  assert.equal(next[2],source[2]);
  assert.deepEqual(source.map(e=>[e.x,e.y]),[[2,20],[92,50],[50,90]]);
  const right=translateSelection(source,['a','b'],20,0,{width:100,height:100});
  assert.equal(right[1].x,100);assert.equal(right[1].x-right[0].x,90);
  assert.equal(translateSelection(source,['a'],0,0),source);
});

test('overflow imports can move toward canvas without snapping on first input',()=>{
  const source=[shape('a',-20,10),shape('b',150,20)];
  const next=translateSelection(source,['a'],1,0,{width:100,height:100});
  assert.equal(next[0].x,-19);
  const other=translateSelection(source,['b'],-1,0,{width:100,height:100});
  assert.equal(other[1].x,149);
});

test('batch layer moves keep internal ordering and skip selected neighbours',()=>{
  const source=['a','b','c','d','e'].map((id,zIndex)=>({...shape(id),zIndex}));
  const ids=e=>e.map(x=>x.id);
  assert.deepEqual(ids(reorderSelection(source,['b','c'],'up')),['a','d','b','c','e']);
  assert.deepEqual(ids(reorderSelection(source,['b','c'],'down')),['b','c','a','d','e']);
  assert.deepEqual(ids(reorderSelection(source,['b','d'],'top')),['a','c','e','b','d']);
  assert.deepEqual(ids(reorderSelection(source,['b','d'],'bottom')),['b','d','a','c','e']);
  assert.deepEqual(ids(source),['a','b','c','d','e']);
});

test('duplicate keeps relative geometry/layers and deep-copies text and masks',()=>{
  const source=[{...shape('top',80,70),zIndex:8,luaMask:{imageId:100002},textBox:{text:'hello'}},{...shape('bottom',20,40),zIndex:2}];
  let n=0;
  const copies=cloneSelection(source,()=>`new-${++n}`,10);
  assert.deepEqual(copies.map(e=>[e.id,e.x,e.y,e.zIndex]),[['new-1',30,50,10],['new-2',90,80,11]]);
  copies[1].luaMask.imageId=100003;copies[1].textBox.text='changed';
  assert.equal(source[0].luaMask.imageId,100002);assert.equal(source[0].textBox.text,'hello');
});
