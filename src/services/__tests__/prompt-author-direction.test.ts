import { describe, expect, it } from 'vitest'

import { extractAuthorDirection, withAuthorDirection } from '../prompt-templates'

const baseContent = [
  '【任务模式：结构迁移 + 原创设定，不是内容复刻】',
  '',
  '【作者创作方向（最高优先级）】',
  '当前填写：自动',
  '本段为“自动”或留空时，按后文多样性要求自由原创。',
  '',
  '【第一章正文（仅作开局节奏参考）】',
  '{{first_chapter}}',
].join('\n')

const template = {
  key: 'infer_novel_config_with_vectors',
  name: '向量采样增强推演（原创仿写版）',
  description: 'test',
  content: baseContent,
  variables: { first_chapter: '第一章正文' },
} as const

describe('extractAuthorDirection', () => {
  it('读取当前填写值', () => {
    expect(extractAuthorDirection(baseContent)).toBe('自动')
  })

  it('读取作者自定义方向', () => {
    const content = baseContent.replace('当前填写：自动', '当前填写：都市异能，主角是中年女性')
    expect(extractAuthorDirection(content)).toBe('都市异能，主角是中年女性')
  })

  it('模板没有该段时返回 null', () => {
    expect(extractAuthorDirection('【其它】\n当前填写：x')).toBeNull()
  })
})

describe('withAuthorDirection', () => {
  it('把方向写回当前填写行，其余正文不动', () => {
    const next = withAuthorDirection(template, '深海题材，金手指要信息类')
    expect(extractAuthorDirection(next.content)).toBe('深海题材，金手指要信息类')
    expect(next.content).toContain('【第一章正文（仅作开局节奏参考）】')
    expect(next.content).toContain('{{first_chapter}}')
    expect(next).not.toBe(template)
  })

  it('空方向回退为“自动”', () => {
    const next = withAuthorDirection(template, '   ')
    expect(extractAuthorDirection(next.content)).toBe('自动')
  })

  it('跨行方向折叠为分号分隔', () => {
    const next = withAuthorDirection(template, '都市异能\n金手指要资源类\n主角是外卖员')
    expect(extractAuthorDirection(next.content)).toBe('都市异能；金手指要资源类；主角是外卖员')
  })

  it('不含该段的模板原样返回', () => {
    const other = { ...template, content: '【其它】\n当前填写：x' }
    expect(withAuthorDirection(other, 'y')).toBe(other)
  })
})
