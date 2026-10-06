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
 * 生成虎扑评论内容（50 字以内的笑话，与帖子无关）
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

  const sysPrompt = '你是一个幽默段子手，擅长讲简短好笑的中文笑话。' +
    '要求：1) 不超过 50 个汉字 2) 像真人发出来的梗或段子 3) 不要"作为AI"、不要编号、不要引言 4) 不要重复之前说过的 5) **直接给笑话，不要思考、不要解释、不要前缀**'

  const userPrompt = '讲一个 50 字以内的中文笑话。'

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
  // 截取第一行 + 限制长度
  const firstLine = cleaned.split('\n')[0].trim().replace(/^["「]|["」]$/g, '')
  return firstLine.slice(0, 80)
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
