import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileToolSchema, toolArgumentError} from '../tool-schema.ts';
const schema={type:'object',properties:{path:{type:'string'},text:{type:'string'}},required:['path','text'],additionalProperties:false};
test('validation never coerces, drops unknown properties, or fills missing required values',()=>{
  for(const [input,category] of [[{path:'a'},'missing_field'],[{path:'a',text:42},'wrong_type'],[{path:'a',text:'x',extra:true},'unknown_field']] as const){
    const before=structuredClone(input);const result=toolArgumentError(schema,input);
    assert.equal(result?.category,category);assert.equal(result?.sideEffect,'not_started');assert.deepEqual(input,before);
  }
  assert.equal(toolArgumentError(schema,{path:'a',text:'x'}),undefined);
});
test('error diagnostics do not leak input values or attacker-controlled property names',()=>{
  const result=toolArgumentError(schema,{path:'a',text:42,'token=secret-must-not-leak':'private-value'});
  assert.ok(!JSON.stringify(result).includes('secret-must-not-leak'));assert.ok(!JSON.stringify(result).includes('private-value'));
});
test('nested constraints and draft2020 are validated; unsupported references fail closed',()=>{
  const nested={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{items:{type:'array',items:{type:'integer',minimum:1}}},required:['items']};
  assert.ok(toolArgumentError(nested,{items:[0]}));assert.ok(toolArgumentError(nested,{items:['2']}));assert.equal(toolArgumentError(nested,{items:[2]}),undefined);
  assert.throws(()=>compileToolSchema({$ref:'https://invalid.example/never-fetch'}),/unsupported/);
});
test('identical IDs from independent MCP servers do not collide or share constraints',()=>{
  const first={$id:'urn:tool:write',type:'object',$defs:{text:{type:'string'}},properties:{text:{$ref:'#/$defs/text'}},required:['text']};
  assert.equal(toolArgumentError(first,{text:'hello'}),undefined);
  assert.equal(toolArgumentError(structuredClone(first),{text:'hello'}),undefined);
  const second={...first,$defs:{text:{type:'number'}}};
  assert.ok(toolArgumentError(second,{text:'hello'}));
  assert.equal(toolArgumentError(second,{text:42}),undefined);
  assert.ok(toolArgumentError(first,{text:42}));
});
