// 虎扑操作抽象
// 两个表：
//   ACTIONS  - 对虎扑接口的写操作（举报 / 推荐 / 点亮等）
//   SCRAPERS - GET 页面 + cheerio 解析的读操作（帖子列表 / 评论列表）
// 调用：
//   executeAction('recommend', { tid, fid, status: 1 }, cookie)
//   executeScraper('threads',   { url: 'https://nba.hupu.com/' })

import axios from 'axios'
import * as cheerio from 'cheerio'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

// 简易 HTML 标签剥除（用于 scraper 返回纯文本）
function stripHtml(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

const BASE_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'content-type': 'application/json',
  priority: 'u=1, i',
  'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': UA
}

/* ===========================================================
   ACTIONS（写操作）
   字段：
     url(params)         -> 完整请求 URL
     body(params)        -> POST payload
     referer(params)?    -> 可选 referer
     label               -> 操作显示名（用于日志）
     method              -> POST / GET（默认 POST）
   =========================================================== */
export const ACTIONS = {
  report: {
    label: '举报',
    url: (p) => `https://bbs.hupu.com/api/v2/threads/${p.tid}/report`,
    body: (p) => ({
      tid: String(p.tid),
      topicId: String(p.topicId),
      type: '4',
      pid: String(p.pid),
      content: '低俗谩骂、阴阳怪气、攻击引战、跨区嘲讽'
    }),
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`
  },

  recommend: {
    label: '推荐',
    url: () => 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/thread/recommend',
    body: (p) => ({
      tid: p.tid,
      recommendStatus: p.status, // 1 = 推荐，0 = 取消推荐
      fid: p.fid
    }),
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`
  },

  light: {
    label: '点亮评论',
    url: () => 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/reply/light',
    body: (p) => ({
      pid: p.pid,
      tid: p.tid,
      puid: p.puid,
      fid: p.fid,
      deviceId: p.deviceId || ''
    }),
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`
  },

  unlight: {
    label: '取消点亮评论',
    url: () => 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/reply/cancelLight',
    body: (p) => ({
      pid: p.pid,
      tid: p.tid,
      puid: p.puid,
      fid: p.fid,
      deviceId: p.deviceId || ''
    }),
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`
  },

  createReply: {
    label: '回复帖子',
    url: () => 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/createReply',
    body: (p) => ({
      topicId: String(p.topicId),
      content: p.content, // 已包含 HTML 标签，如 <p>...</p>
      shumeiId: p.shumeiId || p.deviceId || '',
      deviceid: p.deviceId || p.shumeiId || '',
      tid: p.tid
    }),
    referer: (p) => `https://bbs.hupu.com/${p.tid}-1.html`
  },

  deleteReply: {
    // URL 已确认（200 不是 404）。body 字段名需要在浏览器 hover 看 Network 确认。
    label: '删除回复',
    url: () => 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/reply/delete',
    body: (p) => {
      const pid = String(p.pid)
      // 保守覆盖多种字段命名，等用户验证后精简
      const base = { tid: p.tid, type: 1, reason: 1 }
      return {
        ...base,
        pid,
        pids: [pid],
        replyId: pid
      }
    },
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`
  }
}

/**
 * 通用写操作执行器。
 * @param {string} name  - ACTIONS 里的 key
 * @param {object} params - 业务参数
 * @param {string} cookie - 已登录 cookie
 * @returns {Promise<{status: number, data: any}>}
 */
export async function executeAction(name, params, cookie) {
  const action = ACTIONS[name]
  if (!action) {
    throw Object.assign(new Error(`未知操作: ${name}`), { status: 404 })
  }

  const url = action.url(params)
  const data = action.body(params)
  const referer = action.referer?.(params)
  const method = action.method || 'POST'

  const headers = { ...BASE_HEADERS, cookie: cookie || '' }
  if (referer) headers.referer = referer

  const response = await axios({ method, url, data, headers })
  return { status: response.status, data: response.data }
}

/* ===========================================================
   SCRAPERS（读操作：GET + cheerio 解析）
   字段：
     label           -> 显示名
     run(params)     -> async，返回 { source, count, items, ... }
   =========================================================== */
export const SCRAPERS = {
  /**
   * 抓取帖子列表
   * params: { url?: string } 默认 https://nba.hupu.com/
   * 选择器：.list-item a[href*="bbs.hupu.com/"]
   * 返回：[{ tid, title, board, link }]
   */
  threads: {
    label: '抓取帖子列表',
    async run({ url = 'https://nba.hupu.com/' } = {}) {
      const res = await axios.get(url, { headers: { 'user-agent': UA }, timeout: 12000 })
      const $ = cheerio.load(res.data)
      const items = []
      const seen = new Set()
      $('.list-item a[href*="bbs.hupu.com/"]').each((_, el) => {
        const $a = $(el)
        const href = $a.attr('href') || ''
        const tid = $a.attr('data-tid') || (href.match(/\/(\d+)\.html/) || [])[1] || ''
        const board = $a.attr('data-board-name') || ''
        const title = $a.text().trim()
        if (tid && title && !seen.has(tid)) {
          seen.add(tid)
          items.push({ tid, title, board, link: href })
        }
      })
      return { source: url, count: items.length, items }
    }
  },

  /**
   * 抓取某个号（按 euid）的最近回复/帖子列表
   * params: { euid: string, pageSize?: number }
   * 用 pcmapi/pc/space/v1/getReplyList（带 maxTime）
   * 返回：[{ tid, pid, puid, content, formatTime }]
   */
  userContent: {
    label: '抓取某用户的内容',
    async run({ euid, pageSize = 5 }) {
      if (!euid) throw new Error('缺少 euid')
      const maxTime = Date.now()
      const url = `https://my.hupu.com/pcmapi/pc/space/v1/getReplyList?euid=${euid}&maxTime=${maxTime}&page=1&pageSize=${pageSize}`
      const res = await axios.get(url, {
        headers: { 'user-agent': UA },
        timeout: 12000
      })
      const data = res.data?.data || {}
      const list = data.replyWithQuoteDtoList || []
      const items = list.map((r) => ({
        tid: r.tid,
        pid: r.pid,
        puid: r.puid,
        content: stripHtml(r.content || ''),
        formatTime: r.formatTime || ''
      }))
      return { euid, source: url, count: items.length, items }
    }
  },

  replies: {
    label: '抓取帖子评论',
    async run({ tid }) {
      if (!tid) throw new Error('缺少 tid')
      const url = `https://bbs.hupu.com/${tid}.html`
      const res = await axios.get(url, {
        headers: { 'user-agent': UA },
        timeout: 12000
      })
      const html = res.data
      const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
      if (!m) throw new Error('页面未包含 __NEXT_DATA__')

      let nd
      try {
        nd = JSON.parse(m[1])
      } catch {
        throw new Error('__NEXT_DATA__ 解析失败')
      }

      const detail = nd.props?.pageProps?.detail
      if (!detail) throw new Error('未找到帖子详情')

      const thread = detail.thread || {}
      const title = thread.title || ''
      const fid = thread.fid || ''
      const threadTid = thread.tid || String(tid)

      // 主楼作者
      const threadAuthor = thread.author || {}
      const threadUser = {
        pid: thread.tid, // 主楼没有独立 pid，用 tid 占位
        authorId: thread.authorId || threadAuthor.puid || '',
        username: threadAuthor.puname || '',
        content: stripHtml(thread.content || ''),
        floor: 1,
        createdAt: thread.createdAtFormat || ''
      }

      // 回复列表
      const list = detail.replies?.list || []
      const items = list.map((r) => {
        const u = r.user || {}
        return {
          pid: r.pid,
          puid: r.authorId || u.puid || '',
          username: u.puname || '',
          content: stripHtml(r.content || ''),
          floor: r.floor || 0,
          createdAt: r.createdAtFormat || ''
        }
      })

      return {
        tid: threadTid,
        title,
        fid,
        source: url,
        thread: threadUser,
        count: items.length,
        items
      }
    }
  }
}

/**
 * 通用读操作执行器。
 * @param {string} name  - SCRAPERS 里的 key
 * @param {object} params - 业务参数
 * @returns {Promise<object>} scraper.run 的返回值
 */
export async function executeScraper(name, params) {
  const scraper = SCRAPERS[name]
  if (!scraper) {
    throw Object.assign(new Error(`未知抓取器: ${name}`), { status: 404 })
  }
  return scraper.run(params)
}

