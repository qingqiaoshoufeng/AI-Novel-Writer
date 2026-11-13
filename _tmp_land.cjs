const Database = require('better-sqlite3');
const path = 'D:/雨夜列车/test/新建文件夹 (7)/test7/.ai-novel/project.db';
const db = new Database(path, { readonly: false });

// 1. 读 artifact，从 novelConfig 内层取 architectureFiles / characterCards
const row = db.prepare("SELECT artifact_json FROM generation_artifacts LIMIT 1").get();
const artifact = JSON.parse(row.artifact_json);
const nc = JSON.parse(artifact.text).novelConfig;
const af = nc.architectureFiles || {};
const cc = Array.isArray(nc.characterCards) ? nc.characterCards : [];

console.log('architectureFiles 字段:', Object.keys(af));
console.log('characterCards 数量:', cc.length);
console.log('角色:', cc.map(c => `${c.name}(${c.role})`).join(', '));

// 2. 补写 premise / worldbuilding / synopsis
const setClauses = [];
const values = [];
if (af.premise) { setClauses.push('premise = ?'); values.push(af.premise); }
if (af.worldbuilding) { setClauses.push('worldbuilding = ?'); values.push(af.worldbuilding); }
if (af.synopsis) { setClauses.push('synopsis = ?'); values.push(af.synopsis); }
setClauses.push("updated_at = datetime('now')");
values.push('main');

if (setClauses.length > 1) {
  db.prepare(`UPDATE project_core SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  console.log('\n已补写 architectureFiles 三项');
}

// 3. 验证 project_core
const after = db.prepare("SELECT genre, sub_genre, target_audience, plot_structure, narrative_pov, length(core_outline) as co, length(world_setting) as ws, length(golden_finger) as gf, length(protagonist_profile) as pp, length(premise) as pr, length(worldbuilding) as wb, length(synopsis) as sy FROM project_core WHERE id='main'").get();
console.log('\n=== project_core 验证 ===');
console.log(JSON.stringify(after, null, 2));

// 4. 输出第一张角色卡的字段结构（供确认）
if (cc.length) {
  console.log('\n=== 第一张角色卡字段 ===');
  console.log(Object.keys(cc[0]));
  console.log(JSON.stringify(cc[0], null, 2).slice(0, 1200));
}

// 5. 探测 character_roster_meta 现状
console.log('\n=== character_roster_meta ===');
const crm = db.prepare("SELECT * FROM character_roster_meta WHERE id='main'").get();
console.log(crm ? JSON.stringify(crm) : '(无 main 记录)');

db.close();
console.log('\n完成。');
