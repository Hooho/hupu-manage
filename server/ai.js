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
 * 生成虎扑评论内容（20 字以内，口语化）
 * @param {object} opts
 * @param {string} opts.threadTitle - 帖子标题，作为 prompt 上下文
 * @param {string} [opts.threadContent] - 帖子内容片段（可选）
 * @param {object} opts.config - 包含 ai.provider / ai.apiKey / ai.model
 * @returns {Promise<string>} 生成的评论文本
 */
export async function generateHupuReply({ threadTitle, threadContent, config }) {
  const ai = config?.ai
  if (!ai || !ai.provider) throw new Error('未配置 AI provider')
  if (!ai.apiKey) throw new Error('未配置 AI API key')

  const provider = PROVIDERS[ai.provider]
  if (!provider) throw new Error(`未知 AI provider: ${ai.provider}`)
  const model = ai.model || provider.defaultModel

  const sysPrompt = '你是虎扑论坛的资深用户，擅长用简短、口语化、有态度的中文回复帖子。' +
    '回复要求：1) 不超过 20 个汉字 2) 像真人说话，不要"作为AI"或"以下是" 3) 可以有立场、有梗'

  const userPrompt = threadContent
    ? `帖子标题：${threadTitle}\n帖子摘要：${threadContent}\n\n请给一条简短的回复（不超过 20 字）：`
    : `帖子标题：${threadTitle}\n\n请给一条简短的回复（不超过 20 字）：`

  const res = await axios.post(
    provider.baseUrl,
    {
      model,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 100,
      temperature: 0.9
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
  if (!text) throw new Error('AI 返回内容为空')
  // 截取第一行 + 限制长度
  const firstLine = text.split('\n')[0].trim().replace(/^["「]|["」]$/g, '')
  return firstLine.slice(0, 50)
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
