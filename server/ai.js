// AI provider 抽象：用于自动生成虎扑评论内容
// 目前支持 DeepSeek 和 MiniMax，两者都是 OpenAI 兼容 chat/completions 接口
//
// config.ai 字段：
//   {
//     provider: 'deepseek' | 'minimax',
//     apiKey: 'sk-xxx',
//     model: ''  // 留空用 provider 默认
//   }

import axios from 'axios'

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat'
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.MiniMax.chat/v1/chat/completions',
    defaultModel: 'MiniMax-M3'
  }
}

/**
 * 生成虎扑评论内容（100 字以内的网络热门笑话/梗，与帖子无关）
 * 输出格式：`{provider}：{content}`，例如 `minimax：今天...`
 * 前缀 {provider} 占 8 字符（`minimax：` / `deepseek：`），content 实际可用 ~92 字符
 * @param {object} opts
 * @param {object} opts.config - 包含 ai.provider / ai.apiKey / ai.model
 * @returns {Promise<string>} 生成的笑话文本
 */
export async function generateHupuReply({ config }) {
  const ai = config?.ai
  if (!ai || !ai.provider) throw new Error('未配置 AI provider')
  if (!ai.apiKey) throw new Error('未配置 AI API key')

  const provider = PROVIDERS[ai.provider]
  if (!provider) throw new Error(`未知 AI provider: ${ai.provider}`)
  const model = ai.model || provider.defaultModel
  // 前缀：provider key + 中文全角冒号，例如 `minimax：` / `deepseek：`
  const prefix = `${ai.provider}：`

  const sysPrompt = '你是一个幽默段子手，专门讲当下网络最热门的爆款中文笑话、梗和段子。' +
    '要求：1) 段子正文不超过 90 个汉字（外层会自动加 provider 前缀，总长控制在 100 字内） 2) 优先挑虎扑、微博、抖音、B站评论区近期流传广、点赞多的梗和段子 3) 像真人随手发的那种，让人会心一笑 4) 不要"作为AI"、不要编号、不要引言、不要解释 5) 不要重复之前说过的 6) **直接给段子，不要思考、不要前缀**'

  const userPrompt = '讲一个网上流行的爆款短笑话或梗，90字以内。'

  const res = await axios.post(
    provider.baseUrl,
    {
      model,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 500,
      temperature: 1.0
    },
    {
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  )

  const text = res.data?.choices?.[0]?.message?.content
  if (!text) {
    throw new Error('AI 返回内容为空')
  }
  // 去掉 <think>...</think> reasoning 块（reasoning 模型可能把思考塞进 content）
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  // 截取第一行 + 限制正文长度（92 字符，给 prefix 留 8 字符，总长 ≈100）
  const firstLine = cleaned.split('\n')[0].trim().replace(/^["「]|["」]$/g, '')
  return `${prefix}${firstLine.slice(0, 92)}`
}

/**
 * 列出支持的 AI providers（给前端下拉框用）
 */
export function listProviders() {
  return Object.entries(PROVIDERS).map(([key, v]) => ({
    key,
    name: v.name,
    defaultModel: v.defaultModel
  }))
}

/**
 * 调一次 chat/completions，提取消息内容。剥离 <think> 块。
 * 私有辅助函数。
 */
async function chat({ ai, messages, temperature = 1.0, maxTokens = 800 }) {
  if (!ai || !ai.provider) throw new Error('未配置 AI provider')
  if (!ai.apiKey) throw new Error('未配置 AI API key')
  const provider = PROVIDERS[ai.provider]
  if (!provider) throw new Error(`未知 AI provider: ${ai.provider}`)
  const model = ai.model || provider.defaultModel

  const res = await axios.post(
    provider.baseUrl,
    { model, messages, temperature, max_tokens: maxTokens },
    {
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 90000
    }
  )
  const raw = res.data?.choices?.[0]?.message?.content || ''
  if (!raw) throw new Error('AI 返回内容为空')
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

/**
 * 从 AI 输出里抠出第一个 JSON 对象。容错：
 *  - 包裹 ```json 代码块、首尾有杂字
 *  - JSON 字符串值内嵌了未转义的 ASCII 双引号（模型常见错误），把内部 " 替换成中文「」
 */
function extractJson(text) {
  if (!text) return null
  // 去掉 markdown 代码块围栏
  let t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  // 直接 parse
  try { return JSON.parse(t) } catch {}
  // 找第一个 { 到最后一个 } 的 JSON
  const i1 = t.indexOf('{')
  const i2 = t.lastIndexOf('}')
  if (i1 >= 0 && i2 > i1) {
    const slice = t.slice(i1, i2 + 1)
    try { return JSON.parse(slice) } catch {}
    // 兜底：把内嵌的 ASCII 双引号替换为中文「」
    // 仅在已确定是 {开头、}结尾 的字符串范围内处理
    const fixed = slice.replace(/(?<=[\u4e00-\u9fa5，。：；！？、])"|"(?=[\u4e00-\u9fa5，。：；！？、])/g, '「')
    // 上面的负向处理太复杂；用更稳的策略：把每行  "key": "value"  里 value 内多余 " 转 「
    // 简化：对所有非 key 位置的内部 " 做替换
    try {
      const replaced = slice.replace(/([^\\])\"([^"\\,:{}\[\]\s][^"\\]*?)\"([^"\\,:{}\[\]\s])/g, '$1「$2」$3')
      return JSON.parse(replaced)
    } catch {
      return null
    }
  }
  return null
}

/**
 * Stage 1: curator — 从候选新闻 + 历史经典里挑 1 条最有"步行街味儿"的内容
 * @returns {Promise<{ kind: 'news'|'classic', ref: string, keyPoint: string }>}
 */
async function curatorCall({ ai, newsItems, usedTopics }) {
  const sys = `你是一个 NBA 内容策划，挑选最有"虎扑步行街味儿"的内容做每日帖。
JR 们喜欢：反常识、搞笑、有梗、人情味、争议战、回忆杀、训练花絮、新秀表现、球星/教练轶事、跨界联动。
JR 们不喜欢：纯比分播报、机械数据堆砌、模板化的战报、流言（除非重磅）、AI 味重的"今日 NBA 报道"。
如果候选新闻都不够有意思，可以选 "classic" 自己拟一个有意思的经典主题。`

  const newsBlock = (newsItems || [])
    .slice(0, 15)
    .map((n, i) => `${i + 1}. ${n.title}（${n.category || 'NBA'}）\n   ${n.description || ''}`)
    .join('\n')

  const usedBlock = (usedTopics || []).slice(-30).map((t, i) => `${i + 1}. ${t}`).join('\n')

  const user = `候选新闻：
${newsBlock || '（暂无）'}

最近已用过的经典主题（**避开重复**）：
${usedBlock || '（暂无）'}

请选 1 条做今日帖，返回严格 JSON：
{"kind": "news"|"classic", "ref": "新闻标题 或 经典主题", "keyPoint": "用于 writer 润色的 1-3 句话关键信息"}

只输出 JSON，不要解释。`

  const out = await chat({
    ai,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ],
    temperature: 1.0,
    maxTokens: 3000
  })

  const parsed = extractJson(out)
  if (!parsed || !parsed.kind || !parsed.ref) {
    throw new Error('curator 输出无法解析')
  }
  if (parsed.kind !== 'news' && parsed.kind !== 'classic') {
    parsed.kind = 'classic'
  }
  return {
    kind: parsed.kind,
    ref: String(parsed.ref).slice(0, 200),
    keyPoint: String(parsed.keyPoint || '').slice(0, 400)
  }
}

/**
 * Stage 2: writer — 拿 curation 输出，润色成虎扑步行街风格的标题 + 正文
 * @returns {Promise<{ title: string, body: string }>}
 */
async function writerCall({ ai, curation }) {
  const sys = `你是虎扑步行街的老 JR，每天发帖聊天。写帖风格要求：
- **直接、带点梗、不端着**
- **称呼对方用"JR们"**（结尾常用"JR们怎么看？"）
- 偶尔用"我/兄弟/哥们"拉近距离
- 不堆砌数据、不写"今日 NBA 报道"这种 AI 味重的干巴开头
- 标题要"钩子"：反差、疑问、爆点、数字、冷门、缩写/简称
- 标题 15-30 字
- 正文 3-6 行，80-220 字，最后一句"JR们怎么看？"或类似互动收尾`

  const user = `素材类型：${curation.kind === 'news' ? 'NBA 趣味新闻' : 'NBA 经典冷知识'}
素材主题：${curation.ref}
关键信息：${curation.keyPoint}

请写一篇虎扑步行街风格的帖，返回严格 JSON：
{"title": "...", "body": "..."}

只输出 JSON，不要解释。`

  const out = await chat({
    ai,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ],
    temperature: 1.0,
    maxTokens: 1500
  })

  const parsed = extractJson(out)
  if (!parsed || !parsed.title || !parsed.body) {
    throw new Error('writer 输出无法解析')
  }
  return {
    title: String(parsed.title).slice(0, 60).trim(),
    body: String(parsed.body).slice(0, 400).trim()
  }
}

/**
 * 生成 NBA 主题帖（标题 + 正文）
 * 两阶段：curator 选料 → writer 润色
 *
 * @param {object} opts
 * @param {object} opts.config - 包含 ai 段
 * @param {object[]} opts.newsItems - RSS 抓到的候选新闻（curator 用）
 * @param {string[]} opts.usedTopics - 已用过的经典主题（curator 用作去重提示）
 * @returns {Promise<{ title: string, body: string, kind: 'news'|'classic', ref: string, keyPoint: string }>}
 */
export async function generateHupuThread({ config, newsItems = [], usedTopics = [] }) {
  const ai = config?.ai
  if (!ai || !ai.provider) throw new Error('未配置 AI provider')
  if (!ai.apiKey) throw new Error('未配置 AI API key')

  const curation = await curatorCall({ ai, newsItems, usedTopics })
  const written = await writerCall({ ai, curation })

  return {
    title: written.title,
    body: written.body,
    kind: curation.kind,
    ref: curation.ref,
    keyPoint: curation.keyPoint
  }
}

/* ===========================================================
   Agent Digest 模式（用于"每日自动发帖"切换后的内容生成）

   4 个方向：multi-agent / context / local / sandbox
   3 段式写作：核心结论 / 为什么值得看 / 对 Agent 设计的启发
   =========================================================== */

const STUDIO_SYS_AGENT_CURATOR = `你是一个 AI Agent 领域的"日度策展人"，从候选列表里挑出"**今天最值得开发者读**"的 1 条。

入选标准（必须全部满足，过滤掉只有概念包装的）：
1. **新信息**：有新方法、新实验、新代码、新数据集、新结论；不要"又一个 survey"、"又一个 benchmark"、"又一个综述"
2. **可验证**：有具体数字 / 表格 / 复现路径 / 开源链接
3. **可落地**：开发者读完能据此改变某个设计决策，或学到一个新机制

方向偏好（按重要性排序，不强求）：
1. multi-agent 协作、通信、失败恢复、协调成本
2. context 管理（记忆、压缩、检索、隔离、长任务状态）
3. local agent（本地/边缘推理、runtime、资源、tool calling）
4. sandbox（隔离、容器、权限、可复现环境）

如果今天候选都很弱（包装多于实质），选 kind="classic"，自己拟一个值得讲的概念主题（如"为什么大多数 Agent 失败是 context 问题"）。`

const STUDIO_SYS_AGENT_WRITER = `你是把 AI Agent 论文/报告转写给开发者看的"摘要员"。

铁律（**只陈述事实，不表达观点**）：
- **不要**"为什么值得看"、"对实际 Agent 设计的启发"、"JR 们怎么看" 等评价性内容
- **不要**"老哥们 / 兄弟们 / JR 们"等口语化称呼
- **不要**反问句、感叹号、open question 收尾
- **不要**"祛魅 / 卷 / 拉满 / 智商税 / 真性情"等情绪词
- **不要**"作为 AI"、"综上所述"、"值得关注"
- 不用"我"、"我们"，只用陈述句写"这篇/论文/作者"做了什么

**必须** 5 段式（每段 1-2 句，总长 200-350 字）：
1. **来源**：作者 / 团队 / 发表渠道 / 时间（如已知）
2. **问题**：这篇要解决什么
3. **方法**：核心机制（怎么做的）
4. **结果**：数字、对比、benchmark（按 paper 实际写的，不编）
5. **局限/未做**：作者自述或论文里写明的不足

**输出格式硬性要求**：
- 只输出严格 JSON：{"title": "...", "body": "...", "keyPoint": "..."}
- title 用「主题/论文名：客观描述」结构（如 "SquidAgent：多智能体并行系统的协调成本分析"），不夸张、不反问、不口语
- body 内强调某概念只能用中文双引号「」或全角""，不要 ASCII 双引号
- body 段落间用 \\n\\n 分隔`

/**
 * Stage 1 (Agent Digest): 从候选里挑 1
 * 让 AI 返回 index + 自己的 1 句话核心信息，避免幻觉链接
 * @returns {Promise<{ kind: 'paper'|'classic', ref: string, link?: string, keyPoint: string }>}
 */
async function curatorAgentDigest({ ai, candidates, usedTitles = [] }) {
  const list = (candidates || []).slice(0, 30)
  const block = list
    .map((c, i) => {
      const dir = c.direction ? ` [${c.direction}]` : ''
      const source = c.source ? ` (${c.source})` : ''
      const abs = (c.abstract || '').slice(0, 350)
      return `${i + 1}.${dir}${source} ${c.title}\n   ${abs}`
    })
    .join('\n')

  const usedBlock = (usedTitles || []).slice(-20).map((t, i) => `${i + 1}. ${t}`).join('\n')

  const user = `候选论文/报告（按时间倒序）：
${block || '（暂无）'}

${usedBlock ? `已收录过的主题（**避开这些**）：\n${usedBlock}\n` : ''}请挑 1 条，返回严格 JSON：
{"index": 选中的候选编号（1-${list.length || 0}），"keyPoint": "1-2 句核心信息点（用于 writer 撰写）"}

只输出 JSON，不要解释，不要编链接。`

  const out = await chat({
    ai,
    messages: [
      { role: 'system', content: STUDIO_SYS_AGENT_CURATOR },
      { role: 'user', content: user }
    ],
    temperature: 0.7,
    maxTokens: 1500
  })
  console.log('[curatorAgentDigest] raw len:', out.length, 'full:', JSON.stringify(out))

  const parsed = extractJson(out)
  if (!parsed || (parsed.index == null && !parsed.ref)) {
    throw new Error('curator(AgentDigest) 输出无法解析')
  }

  // 优先按 index 定位候选，避免幻觉
  const idx = Number(parsed.index)
  if (Number.isInteger(idx) && idx >= 1 && idx <= list.length) {
    const c = list[idx - 1]
    return {
      kind: 'paper',
      ref: c.title,
      link: c.link || c.url || '',
      keyPoint: String(parsed.keyPoint || '').slice(0, 600)
    }
  }

  // 兜底：按 ref 模糊匹配
  if (parsed.ref) {
    const refLower = String(parsed.ref).toLowerCase()
    const matched = list.find((c) =>
      (c.title || '').toLowerCase().includes(refLower.slice(0, 30))
    )
    if (matched) {
      return {
        kind: 'paper',
        ref: matched.title,
        link: matched.link || matched.url || '',
        keyPoint: String(parsed.keyPoint || '').slice(0, 600)
      }
    }
  }

  // 实在匹配不到，kind=classic 自己拟
  return {
    kind: 'classic',
    ref: String(parsed.ref || 'AI Agent 实战话题').slice(0, 200),
    link: '',
    keyPoint: String(parsed.keyPoint || '').slice(0, 600)
  }
}

/**
 * Stage 2 (Agent Digest): 写 5-段式客观摘要
 * paper 形如 { title, link, abstract, authors, source, primaryCategory, ... }
 * @returns {Promise<{ title: string, body: string, keyPoint: string }>}
 */
async function writerAgentDigest({ ai, paper }) {
  const lines = [
    `标题：${paper.title}`,
    paper.link ? `链接：${paper.link}` : null,
    paper.source ? `来源：${paper.source}` : null,
    paper.authors && paper.authors.length ? `作者：${paper.authors.join(', ')}` : null,
    paper.primaryCategory ? `领域：${paper.primaryCategory}` : null,
    paper.abstract ? `摘要：${paper.abstract.slice(0, 1000)}` : null
  ].filter(Boolean).join('\n')

  const user = `${lines}

请按 system 提示的 5 段式（来源/问题/方法/结果/局限）写一篇客观摘要。
如果摘要里没有具体的数字或结果，就用"论文未给具体数字"等表述，不要编。
如果作者未提及局限，就写"论文未明确局限"。

只输出严格 JSON：{"title": "...", "body": "...", "keyPoint": "..."}`

  const out = await chat({
    ai,
    messages: [
      { role: 'system', content: STUDIO_SYS_AGENT_WRITER },
      { role: 'user', content: user }
    ],
    temperature: 0.4, // 降低温度让输出更稳定、客观
    maxTokens: 3000
  })
  console.log('[writerAgentDigest] raw len:', out.length, 'preview:', out.slice(0, 300))

  const parsed = extractJson(out)
  if (!parsed || !parsed.title || !parsed.body) {
    throw new Error('writer(AgentDigest) 输出无法解析')
  }
  return {
    title: String(parsed.title).slice(0, 60).trim(),
    body: String(parsed.body).slice(0, 1200).trim(),
    keyPoint: String(parsed.keyPoint || '').slice(0, 600).trim()
  }
}

/**
 * 生成 AI Agent digest 帖
 * @param {object} opts
 * @param {object} opts.config - 包含 ai 段
 * @param {object[]} opts.candidates - aiPapers scraper 抓到的候选
 * @returns {Promise<{ title, body, kind, ref, link, keyPoint }>}
 */
export async function generateAgentDigestPost({ config, candidates = [], usedTitles = [] }) {
  const ai = config?.ai
  if (!ai || !ai.provider) throw new Error('未配置 AI provider')
  if (!ai.apiKey) throw new Error('未配置 AI API key')

  const curation = await curatorAgentDigest({ ai, candidates, usedTitles })
  const written = await writerAgentDigest({
    ai,
    paper: {
      title: curation.ref,
      link: curation.link,
      abstract: curation.keyPoint,
      source: 'curator-pick'
    }
  })

  return {
    title: written.title,
    body: written.body,
    kind: curation.kind,
    ref: curation.ref,
    link: curation.link,
    keyPoint: written.keyPoint || curation.keyPoint
  }
}

/**
 * 给定一篇 paper（已由调度层选好），由 AI 直接写 5 段式客观摘要。
 * 适用于"调度层硬选"模式：所有账号/帖子 100% 不重复。
 */
export async function writePaperPost({ config, paper }) {
  const ai = config?.ai
  if (!ai || !ai.provider) throw new Error('未配置 AI provider')
  if (!ai.apiKey) throw new Error('未配置 AI API key')

  const written = await writerAgentDigest({ ai, paper })
  return {
    title: written.title,
    body: written.body,
    kind: 'paper',
    ref: paper.title,
    link: paper.link || paper.url || '',
    keyPoint: written.keyPoint
  }
}
