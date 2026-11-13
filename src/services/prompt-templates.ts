import type { ProjectSessionContext } from '../shared/ipc-channels'
import { resolveWritingLanguage, type WritingLanguage } from '../shared/writing-language'
import { getActiveProjectSessionContext } from '../shared/project-session-context'
import { PromptCatalog, ipcPromptPersistence } from './prompt-catalog'
import { BUILTIN_PROMPTS, getBuiltinPromptTemplate, type PromptTemplate } from './builtin-prompt-templates'
export * from './builtin-prompt-templates'

/** 提示词生命周期唯一所有者；工作流通过 async resolve 自动完成水合。 */
export const promptCatalog = new PromptCatalog(
  BUILTIN_PROMPTS,
  ipcPromptPersistence,
  getActiveProjectSessionContext,
)

/** 项目关闭、切换或新加载开始时立即失效，绝不沿用旧 lease 的覆盖。 */
export function clearProjectCustomPrompts(): void {
  promptCatalog.clearProject()
}

/** 加载全局自定义 Prompt 覆盖（从 ~/.vela/prompts/ 目录） */
export async function loadCustomPrompts(writingLanguage: WritingLanguage = 'zh-CN'): Promise<void> {
  await promptCatalog.list(undefined, writingLanguage)
}

/** 加载项目级自定义 Prompt 覆盖（从 {projectPath}/.vela/prompts/ 目录） */
export async function loadProjectCustomPrompts(
  projectSession: ProjectSessionContext,
  writingLanguage: WritingLanguage = 'zh-CN',
): Promise<boolean> {
  return promptCatalog.loadProject(projectSession, writingLanguage)
}

/** 根据 key 获取 Prompt 模板（三级优先级：当前 session 项目级 > 全局级 > 内置） */
export function getPromptTemplate(
  key: string,
  projectSession?: ProjectSessionContext,
  writingLanguage: WritingLanguage = 'zh-CN',
): PromptTemplate | undefined {
  const resolved = promptCatalog.peek(key, projectSession, resolveWritingLanguage(writingLanguage))
  if (!resolved || resolved.source === 'builtin') return getBuiltinPromptTemplate(key, writingLanguage)
  return resolved.template
}

/** 工作流读取入口：首次调用会自动等待全局与当前项目覆盖水合。 */
export async function resolvePromptTemplate(
  key: string,
  projectSession: ProjectSessionContext | undefined,
  writingLanguage: WritingLanguage,
): Promise<PromptTemplate | undefined> {
  const language = resolveWritingLanguage(writingLanguage)
  const resolved = await promptCatalog.resolve(key, projectSession, language)
  if (!resolved) return undefined
  return resolved.source === 'builtin'
    ? getBuiltinPromptTemplate(key, writingLanguage)
    : resolved.template
}

/** 获取指定模板当前生效的来源 */
export function getPromptSource(
  key: string,
  projectSession?: ProjectSessionContext,
  writingLanguage: WritingLanguage = 'zh-CN',
): 'builtin' | 'global' | 'project' {
  return promptCatalog.peek(key, projectSession, resolveWritingLanguage(writingLanguage))?.source ?? 'builtin'
}

/** 获取所有模板（合并自定义，保留三级覆盖优先级） */
export function getAllPromptTemplates(
  projectSession?: ProjectSessionContext,
  writingLanguage: WritingLanguage = 'zh-CN',
): PromptTemplate[] {
  return BUILTIN_PROMPTS.map((template) => (
    getPromptTemplate(template.key, projectSession, writingLanguage) ?? template
  ))
}

/** 保存全局自定义 Prompt 到 ~/.vela/prompts/ */
export async function saveCustomPrompt(template: PromptTemplate): Promise<boolean> {
  return promptCatalog.commit({ action: 'save', scope: 'global', template })
}

/** 保存项目级自定义 Prompt 到 {projectPath}/.vela/prompts/ */
export async function saveProjectCustomPrompt(
  projectSession: ProjectSessionContext,
  template: PromptTemplate,
): Promise<boolean> {
  return promptCatalog.commit({ action: 'save', scope: 'project', projectSession, template })
}

/** 删除全局自定义 Prompt（恢复为内置版本） */
export async function deleteCustomPrompt(
  key: string,
  writingLanguage: WritingLanguage = 'zh-CN',
): Promise<boolean> {
  return promptCatalog.commit({ action: 'delete', scope: 'global', key, writingLanguage })
}

/** 删除项目级自定义 Prompt（恢复为全局/内置版本） */
export async function deleteProjectCustomPrompt(
  projectSession: ProjectSessionContext,
  key: string,
  writingLanguage: WritingLanguage = 'zh-CN',
): Promise<boolean> {
  return promptCatalog.commit({ action: 'delete', scope: 'project', projectSession, key, writingLanguage })
}

/** 原创仿写模板【作者创作方向】段的标记行；模板由提示词设置安装，正文自带该段。 */
const AUTHOR_DIRECTION_HEADER = '【作者创作方向（最高优先级）】'
const AUTHOR_DIRECTION_VALUE_PREFIX = '当前填写：'

/** 从模板正文提取【作者创作方向】当前值；模板不含该段时返回 null。 */
export function extractAuthorDirection(content: string): string | null {
  const headerIndex = content.indexOf(AUTHOR_DIRECTION_HEADER)
  if (headerIndex < 0) return null
  const lineIndex = content.indexOf(AUTHOR_DIRECTION_VALUE_PREFIX, headerIndex)
  if (lineIndex < 0 || lineIndex - headerIndex > 200) return null
  const start = lineIndex + AUTHOR_DIRECTION_VALUE_PREFIX.length
  const end = content.indexOf('\n', start)
  const value = content.slice(start, end < 0 ? undefined : end).trim()
  return value.length > 0 ? value : '自动'
}

/** 把创作方向写回模板正文；方向跨行时折叠为分号分隔，空值回退为“自动”。 */
export function withAuthorDirection(template: PromptTemplate, direction: string): PromptTemplate {
  const headerIndex = template.content.indexOf(AUTHOR_DIRECTION_HEADER)
  if (headerIndex < 0) return template
  const lineIndex = template.content.indexOf(AUTHOR_DIRECTION_VALUE_PREFIX, headerIndex)
  if (lineIndex < 0) return template
  const start = lineIndex + AUTHOR_DIRECTION_VALUE_PREFIX.length
  const end = template.content.indexOf('\n', start)
  const normalized = direction.replace(/\s*\n+\s*/g, '；').trim()
  const content = `${template.content.slice(0, start)}${normalized || '自动'}${end < 0 ? '' : template.content.slice(end)}`
  return { ...template, content }
}

export { appendRequiredPromptContext, renderPromptTaskGuidance, renderPrompt } from '../shared/render-prompt'
