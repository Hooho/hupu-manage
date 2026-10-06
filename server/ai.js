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
      timeout: 30000
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
