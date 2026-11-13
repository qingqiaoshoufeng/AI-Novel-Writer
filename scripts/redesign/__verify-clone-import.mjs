/* 临时验证脚本（跑完即删）：隔离环境启动书童，用真实 MiniMax 模型对参考小说执行「拆解与仿写」，验证原创仿写模板生效。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

import { chooseProjectDirectoryGrant } from '../project-directory-grant.mjs'
import { dismissStartupNotice, waitForShell } from './pages/shell.mjs'
import * as runSheet from './pages/run-sheet.mjs'
import * as stage from './pages/stage.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OFFSCREEN_WINDOW = fileURLToPath(new URL('./offscreen-window.cjs', import.meta.url))
const NOVEL = 'D:/tmp/死亡列车开局SSS级天赋.txt'
const VITE_URL = 'http://localhost:5180'
const REAL_GLOBAL = path.join(process.env.APPDATA, 'ai-novel-writer-data', 'generations', 'd785dd8a-e637-4151-b4ba-6cfec1bcbfae')
const CUSTOM_PROMPTS = path.join(REPO, 'custom-prompts')
const BOOK = '克隆验证'

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args)

const invoke = (page, channel, ...args) =>
  page.evaluate(({ channel, args }) => window.aiNovelAPI.invoke(channel, ...args), { channel, args })

async function trackOpenedSession(app) {
  await app.evaluate(({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers
    const original = handlers.get('project:open')
    handlers.set('project:open', async (event, projectPath, ...rest) => {
      const result = await original(event, projectPath, ...rest)
      if (result?.success) globalThis.__driveOpened = { projectId: result.project.id, projectPath, leaseId: result.project.sessionLease }
      return result
    })
  })
}

// --- 隔离根目录 ---
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'an-verify-'))
const roots = Object.fromEntries(['userData', 'projects', 'legacy', 'canonical', 'home', 'appData', 'localAppData', 'temp']
  .map(name => [name, path.join(root, name)]))
for (const dir of Object.values(roots)) fs.mkdirSync(dir, { recursive: true })
log('隔离根目录:', root)

const env = {
  ...process.env,
  AI_NOVEL_APP_DATA_HOME: roots.canonical,
  AI_NOVEL_LEGACY_SOURCE_HOME: roots.legacy,
  AI_NOVEL_VELA_HOME: roots.legacy,
  HOME: roots.home, USERPROFILE: roots.home, APPDATA: roots.appData,
  LOCALAPPDATA: roots.localAppData, TEMP: roots.temp, TMP: roots.temp,
  VITE_DEV_SERVER_URL: VITE_URL,
}
for (const name of ['ELECTRON_RUN_AS_NODE', 'AI_NOVEL_SMOKE_OPEN_PROJECT', 'AI_NOVEL_SMOKE_PROJECT_MARKER']) delete env[name]

// --- 真实模型配置（含密钥，只在内存中传递） ---
const realModels = JSON.parse(fs.readFileSync(path.join(REAL_GLOBAL, 'models.json'), 'utf8'))
const allModels = Array.isArray(realModels) ? realModels : realModels.models ?? []
const model = allModels.find(m => m.name === 'MiniMax M3.1 Flash（官方）')
assert.ok(model, '未找到 MiniMax M3.1 Flash 模型配置')
const embeddingModel = allModels.find(m => (m.purposes ?? []).includes('embedding'))
assert.ok(embeddingModel, '未找到检索（embedding）模型配置')
log('使用模型:', model.name, model.baseUrl, '| 检索:', embeddingModel.name, embeddingModel.baseUrl)

const app = await electron.launch({ cwd: REPO, args: ['-r', OFFSCREEN_WINDOW, '.', `--user-data-dir=${roots.userData}`, '--lang=zh-CN'], env, timeout: 60_000 })
let page
try {
  page = await app.firstWindow({ timeout: 60_000 })
  page.setDefaultTimeout(20_000)
  await waitForShell(page, 60_000)
  await dismissStartupNotice(page)
  assert.equal((await invoke(page, 'startup:get-state')).state, 'ready')

  // 1. 保存真实模型并设为默认（含检索模型）
  assert.equal((await invoke(page, 'llm:save-model', model)).success, true)
  assert.equal((await invoke(page, 'llm:save-model', embeddingModel)).success, true)
  assert.equal((await invoke(page, 'llm:set-default-model', model.id)).success, true)
  assert.equal((await invoke(page, 'llm:set-default-embedding-model', embeddingModel.id)).success, true)
  log('模型已配置')

  // 2. 新建隔离作品
  const grant = await chooseProjectDirectoryGrant(app, page, roots.projects)
  const created = await invoke(page, 'project:create', { parentGrantId: grant.grantId, name: BOOK, genre: '', targetAudience: '', writingLanguage: 'zh-CN' }, randomUUID(), null)
  assert.equal(created.success, true, created.error)
  const projectPath = created.projectPath ?? created.project?.path
  assert.ok(projectPath, 'project:create 未返回路径')
  log('作品已创建:', projectPath)

  // 3. 安装原创仿写模板：项目级 + 隔离全局级
  const projectPromptsDir = path.join(projectPath, '.ai-novel', 'prompts')
  fs.mkdirSync(projectPromptsDir, { recursive: true })
  for (const f of fs.readdirSync(CUSTOM_PROMPTS)) {
    fs.copyFileSync(path.join(CUSTOM_PROMPTS, f), path.join(projectPromptsDir, f))
    const legacyPrompts = path.join(roots.legacy, 'prompts')
    fs.mkdirSync(legacyPrompts, { recursive: true })
    fs.copyFileSync(path.join(CUSTOM_PROMPTS, f), path.join(legacyPrompts, f))
  }
  log('模板已装入项目级与隔离全局级')

  // 4. 重载并打开作品
  await trackOpenedSession(app)
  await page.reload()
  await waitForShell(page, 60_000)
  await dismissStartupNotice(page)
  await stage.openFromLibrary(page, BOOK)
  await trackOpenedSession(app)
  const session = await app.evaluate(() => globalThis.__driveOpened)
  assert.ok(session?.leaseId, '记录了打开会话')
  log('作品已打开:', session.projectPath)

  // 5. mock 文件对话框并走导入流程
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, NOVEL)
  await stage.root(page).getByRole('banner').getByRole('button', { name: `《${BOOK}》作品菜单` }).click()
  await page.getByRole('menuitem', { name: '小说拆解与仿写…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '小说拆解与仿写' })
  await dialog.getByTestId('import-purpose-reference').click()
  await dialog.getByTestId('import-target-current').click()
  await dialog.getByTestId('import-source-choose').click()
  await dialog.getByTestId('import-preview-summary').waitFor({ state: 'visible', timeout: 120_000 })
  const confirmButton = dialog.getByRole('button', { name: /导入当前项目（\d+ 章）|开始拆解仿写（\d+ 章）/u })
  const label = await confirmButton.innerText()
  log('确认按钮:', label.trim())
  await confirmButton.click()
  await dialog.waitFor({ state: 'hidden' })
  await runSheet.waitUntilOpen(page)
  log('导入已开始，等待完成（长任务，可能 1 小时以上）...')

  // 6. 等待运行完成
  await runSheet.waitForRunDone(page, 4 * 60 * 60 * 1000)
  log('导入运行完成')

  // 7. 读取结果并判定
  const core = await invoke(page, 'db:project-core-get', session.projectPath, session)
  const blueprints = await invoke(page, 'db:blueprint-get-all', session.projectPath, session)
  const banned = ['陈野', '怪力乱神', '死亡列车', '树皮人', 'G5002', '秦照阳', '周雅婷', '顾清欢']
  const coreText = ['genre', 'subGenre', 'coreOutline', 'worldSetting', 'goldenFinger', 'protagonistProfile', 'premise', 'worldbuilding', 'synopsis']
    .map(k => String(core?.[k] ?? '')).join('\n')
  const bpText = blueprints.map(b => `${b.title ?? ''}${b.keyEvents ?? b.key_events ?? ''}`).join('\n')
  const hitCore = banned.filter(w => coreText.includes(w))
  const hitBp = banned.filter(w => bpText.includes(w))
  console.log('\n================ 验证结果 ================')
  console.log('章节数(蓝图):', blueprints.length)
  console.log('设定命中原作专名:', hitCore.length ? hitCore.join('、') : '无 ✓')
  console.log('蓝图命中原作专名:', hitBp.length ? hitBp.join('、') : '无 ✓')
  console.log('\n[genre]', core?.genre)
  console.log('[coreOutline]', String(core?.coreOutline ?? '').slice(0, 260))
  console.log('[worldSetting]', String(core?.worldSetting ?? '').slice(0, 260))
  console.log('[goldenFinger]', String(core?.goldenFinger ?? '').slice(0, 200))
  console.log('[protagonistProfile]', String(core?.protagonistProfile ?? '').slice(0, 200))
  for (const b of blueprints.slice(0, 3)) {
    console.log(`\n--- 蓝图第${b.chapterNumber}章 ${b.title} (${b.role ?? ''})`)
    console.log('keyEvents:', String(b.keyEvents ?? b.key_events ?? '').slice(0, 260))
    console.log('characters:', JSON.stringify(b.characters ?? []))
  }
  console.log('\n判定:', (hitCore.length || hitBp.length) ? 'FAIL：产出含原作专名，模板未生效或模型复刻' : 'PASS：设定与蓝图均为原创内容')
} finally {
  await app.close().catch(() => {})
}
