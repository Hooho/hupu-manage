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

// =============================================================
// App 端 reply 接口（bbsreplyapi/reply/v1/app/create）的固定 body
// =============================================================
// Hupu 的 sign 算法对 byte-for-byte 字符串算签名 —— 包括 `\/` 这种字面转义
// JSON.stringify 默认不转义 `/`，所以如果 body 走对象 → axios 自动 stringify 会少 4 字节 `\/` 转义 → 403「签名异常」
// 解法：直接把 capture 的原 body 当字面字符串返回，axios 看到 data 是字符串会原样发（不会 JSON.stringify）
//
// capture 时间：2026-10-07 17:39:29 UTC（whistle 抓包），base64 是 req.base64 字段
// 解码后是 480 字节的 JSON 字符串（4 处 `\/` 字面转义）
// 想换 tid / content / 任何字段都得重新抓包 —— 改了就 sign 失效
// 完整 capture 文件：whistle 抓包目录 `...replay.txt` 的 req.base64（见抓包说明.md）
const APP_REPLY_BODY =
  '{"content":"<p>test<\\/p>","fid":"34","tid":"642813512","clientId":"177441061","crt":"1791394558460","night":"0","channel":"huawei","teenagers":"0","time_zone":"Asia\\/Shanghai","deviceId":"BNDC1fXSaHtp7yUnlSRKA1Dd+h28fgKDDApxYVnxWEoL4D6ty0QpQJc9RRGew531BzZCKJoJfNs1878KP4qNhLDYrNMx4N5\\/+nUlAB5+zy0aVDerWUSMh9WnQpfzrYPALXCB0E8u5u0aQYaxHlBPN0SEi\\/R6gosuf3MI8aZW4d4I=","token":"NDg0MjUxOTA=|MTc5MTM1OTk4OA==|eb13fbaf2fc8c4a811cc1886fc782bbe","sign":"b50cb334537ef8f2432824b69a5088a3"}'

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

/**
 * 把 account.appSessions[key] 转成 axios headers
 *
 * 字段分为两层：
 * - 账号共享（account.appAuth）：xHupuToken / cookie
 *   同一账号下基本不变，账号只需配置一次
 * - session 专有（account.appSessions[key]）：hupuNewSign / hupuEncryptSalt
 *   per-request 变，session 过期重抓
 *
 * 写死字段（不读 config）：
 * - host：axios 从 URL 自动提取
 * - user-agent：固定 Android Dalvik UA
 *
 * 读取顺序：session 字段 → 账号共享字段（fallback）
 */
const APP_USER_AGENT =
  'Dalvik/2.1.0 (Linux; U; Android 12; 2304FPN6DC Build/W528JS) kanqiu/8.2.63.09241/12314'

function appSessionHeaders(p, key) {
  const account = (p && p._account) || {}
  const common = account.appAuth || {}
  const s = ((account.appSessions || {})[key]) || (p && p._appSessions && p._appSessions[key]) || {}
  return {
    'user-agent': APP_USER_AGENT,
    'hupu-new-sign': s.hupuNewSign || common.hupuNewSign || '',
    'hupu-encrypt-salt': s.hupuEncryptSalt || '',
    'hupu-key-version': '1',
    'x-hupu-token': s.xHupuToken || common.xHupuToken || '',
    cookie: s.cookie || common.cookie || ''
  }
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
     isSuccess(data)?    -> {ok, idempotent?, reason?}  业务成功判断（可选）
       - 默认：data.code === 1 视为成功，其他抛错
       - ok:true + idempotent  视为幂等成功（不算失败）
       - ok:false 抛错，scheduler 可 catch
   =========================================================== */
const DEFAULT_SUCCESS = (data) => {
  // pcmapi v1 用 code=1 表示成功；/api/v2/ 用 code=200 表示成功（REST 风格）
  if (data?.code === 1 || data?.code === 200) return { ok: true }
  // v2 接口用 message，v1 用 msg，两个都看
  return { ok: false, reason: data?.msg || data?.message || `code=${data?.code}` }
}

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
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`,
    isSuccess: DEFAULT_SUCCESS
  },

  recommend: {
    label: '推荐',
    url: () => 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/thread/recommend',
    body: (p) => ({
      tid: p.tid,
      recommendStatus: p.status, // 1 = 推荐，0 = 取消推荐
      fid: p.fid
    }),
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`,
    isSuccess: (data) => {
      // 推荐接口：成功 code:1；已推荐过 = 幂等成功；其他抛错
      if (data?.code === 1) return { ok: true }
      if (typeof data?.msg === 'string' && /已|已经|重复/.test(data.msg)) {
        return { ok: true, idempotent: true, reason: data.msg }
      }
      return { ok: false, reason: data?.msg || `code=${data?.code}` }
    }
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
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`,
    isSuccess: (data) => {
      // 点亮：code:1 = 真点亮；internalCode PC090002 = 已点亮过 = 幂等
      if (data?.code === 1) return { ok: true }
      if (data?.internalCode === 'PC090002') {
        return { ok: true, idempotent: true, reason: '已点亮过' }
      }
      return { ok: false, reason: data?.msg || `code=${data?.code}` }
    }
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
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`,
    isSuccess: (data) => {
      // 取消点亮：code:1 = 真取消；internalCode PC090003 = 未点亮过 = 幂等
      if (data?.code === 1) return { ok: true }
      if (data?.internalCode === 'PC090003') {
        return { ok: true, idempotent: true, reason: '未点亮过' }
      }
      return { ok: false, reason: data?.msg || `code=${data?.code}` }
    }
  },

  createReply: {
    label: '回复帖子',
    url: () => 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/createReply',
    body: (p) => ({
      topicId: String(p.topicId),
      content: p.content,
      shumeiId: p.shumeiId || p.deviceId || '',
      deviceid: p.deviceId || p.shumeiId || '',
      tid: p.tid
    }),
    referer: (p) => `https://bbs.hupu.com/${p.tid}-1.html`,
    isSuccess: DEFAULT_SUCCESS
  },

  createThread: {
    // 发帖（创建主题帖）
    // 字段按 createReply 推断：fid(板块) + title + content + 数美双字段
    // 注意：endpoint 是猜的，跑通前需要先 .find-post-api.mjs 验证；风控要求同 createReply
    label: '发帖',
    url: () => 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/createThread',
    body: (p) => ({
      fid: String(p.fid),
      title: p.title,
      content: p.content,
      shumeiId: p.shumeiId || p.deviceId || '',
      deviceid: p.deviceId || p.shumeiId || ''
    }),
    referer: (p) => `https://bbs.hupu.com/post.xhtml?fid=${p.fid}`,
    isSuccess: DEFAULT_SUCCESS
  },

  deleteReply: {
    label: '删除回复',
    url: () => 'https://bbs.hupu.com/pcmapi/pc/bbs/v1/reply/delete',
    body: (p) => {
      const pid = String(p.pid)
      const base = { tid: p.tid, type: 1, reason: 1 }
      return { ...base, pid, pids: [pid], replyId: pid }
    },
    referer: (p) => `https://bbs.hupu.com/${p.tid}.html`,
    isSuccess: DEFAULT_SUCCESS
  },

  // ===========================================
  // App 端 mobileapi 写操作（通过 hupu-new-sign header 鉴权）
  // ===========================================
  // 关键发现（2026-10）：notifyShareInfo 接口
  //   - hupu-new-sign 头是 session-level 固定值（多次重发相同 sign 都过）
  //   - body 里的 sign 字段是装饰，可省略
  //   - bizId 必须对应真实存在的帖子（业务校验）
  //   - crt/actionTime 任意填都行（不影响 sign）
  // 抓包一次后填进 config.appAuth，重放稳定
  notifyShare: {
    label: 'App 分享上报',
    url: () => 'https://bbs.mobileapi.hupu.com/1/8.2.63/bbsintapi/share/v1/notifyShareInfo',
    body: (p) => {
      const now = Date.now()
      return {
        assocID: String(p.bizId),
        actionTime: now,
        shareTitle: p.shareTitle || `分享帖子 ${p.bizId}`,
        bizId: String(p.bizId),
        sharePlatform: 1,
        shareURL: p.shareURL || `https://m.hupu.com/bbs-share/${p.bizId}.html?share=share`,
        shareType: '3',
        cid: '177441061',
        clientId: '177441061',
        crt: String(now + 1400),
        night: '0',
        channel: 'huawei',
        teenagers: '0',
        time_zone: 'Asia/Shanghai',
        // deviceId/token/sign 这些字段保留无害（body 的 sign 字段是装饰）
        deviceId: '',
        token: '',
        sign: ''
      }
    },
    headers: (p) => appSessionHeaders(p, 'share'),
    isSuccess: (data) => {
      if (data?.returnCode === '00000000' || data?.code === 200) return { ok: true }
      return { ok: false, reason: data?.msg || `code=${data?.code}` }
    }
  },

  // ===========================================
  // App 端 createReply（v1/app/create）
  // ===========================================
  // 关键发现（2026-10）：bbsreplyapi/reply/v1/app/create
  //   - body 的 sign 是真签名（跟 notifyShare 不同，那个 sign 是装饰）
  //   - 改 body 任何字段都会 403「签名异常」
  //   - body 全字段必须原样回放（crt/deviceId/token/sign 都锁死）
  //   - header 的 hupu-new-sign 是 session-level 固定（跟 notifyShare 一样）
  // 适用场景：刷固定帖子固定回复（增加声望）。换帖/换文需重新抓。
  // 抓包时间：2026-10-07；首次验证 17:39:29 UTC，跨日重发 17:47:40 UTC 都成功
  appReply: {
    label: 'App 端回复帖子',
    url: () => 'https://bbs.mobileapi.hupu.com/1/8.2.63/bbsreplyapi/reply/v1/app/create',
    body: () => APP_REPLY_BODY,
    headers: (p) => ({
      ...appSessionHeaders(p, 'reply'),
      'content-type': 'application/json;charset=UTF-8'
    }),
    isSuccess: (data) => {
      // 成功：status === "200" + result.pid 是新回帖 id
      // 失败：status === "403" 之类 + msg（如「签名异常」）
      if (String(data?.status) === '200' && data?.result?.pid) return { ok: true }
      return { ok: false, reason: data?.msg || `status=${data?.status}` }
    }
  },

  // ===========================================
  // App 端关注 / 取关（games.mobileapi.hupu.com / bplapi/user/v1/*）
  // ===========================================
  // 关键发现（2026-10）：
  //   - host 是 games.mobileapi.hupu.com（不是 bbs.mobileapi.hupu.com）
  //   - content-type: application/x-www-form-urlencoded（不是 JSON）
  //   - body 的 sign 是真签名（跟 reply 同模式），改 buddyPuid 字段就 403
  //   - hupu-new-sign / hupu-encrypt-salt 是 per-request 的（不是 session-level），
  //     每次请求都会换 —— session header 写死不靠谱，要等 long term 时重新抓包
  //   - header 的 x-hupu-token / cookie / user-agent 跨 addFollow 和 delFollow 一致
  // 适用场景：刷互关声望；加新 puid 必须重新抓包（sign 绑死 buddyPuid）
  // capture 时间：2026-10-08（addFollow 14:36 UTC，delFollow 14:36 UTC 同分钟）
  // config.appFollowConfig.{addFollow,delFollow} 是 {puid: formEncodedBody} 映射
  appFollow: {
    label: 'App 关注用户',
    url: () => 'https://games.mobileapi.hupu.com/1/8.2.63/bplapi/user/v1/addFollow',
    body: (p) => {
      const cfg = p._appFollowConfig || {}
      // per-account 结构：cfg[fromAccountId].addFollow[buddyPuid]
      const fromId = p._fromAccountId || (p._account && p._account.id) || 'A'
      const accCfg = cfg[fromId] || {}
      const map = accCfg.addFollow || {}
      const puid = String(p.buddyPuid || '98884021')
      if (!map[puid]) {
        throw new Error(
          `appFollow 未配置 账号 ${fromId} → buddyPuid=${puid} 的 capture body —— 加新 puid 必须重新抓包填进 config.appFollowConfig.${fromId}.addFollow`
        )
      }
      return map[puid]
    },
    headers: (p) => ({
      ...appSessionHeaders(p, 'follow'),
      'content-type': 'application/x-www-form-urlencoded'
    }),
    isSuccess: (data) => {
      // 关注成功：status=200, result.currentRelationLevel=2（已互关）/1（已关注）
      // 重复关注：也是 status=200，result.currentRelationLevel 不变（幂等成功）
      if (Number(data?.status) === 200) return { ok: true }
      return { ok: false, reason: data?.msg || `status=${data?.status}` }
    }
  },

  appUnfollow: {
    label: 'App 取关用户',
    url: () => 'https://games.mobileapi.hupu.com/1/8.2.63/bplapi/user/v1/delFollow',
    body: (p) => {
      const cfg = p._appFollowConfig || {}
      const fromId = p._fromAccountId || (p._account && p._account.id) || 'A'
      const accCfg = cfg[fromId] || {}
      const map = accCfg.delFollow || {}
      const puid = String(p.buddyPuid || '98884021')
      if (!map[puid]) {
        throw new Error(
          `appUnfollow 未配置 账号 ${fromId} → buddyPuid=${puid} 的 capture body —— 加新 puid 必须重新抓包填进 config.appFollowConfig.${fromId}.delFollow`
        )
      }
      return map[puid]
    },
    headers: (p) => ({
      ...appSessionHeaders(p, 'follow'),
      'content-type': 'application/x-www-form-urlencoded'
    }),
    isSuccess: (data) => {
      // 取关成功：status=200, result.currentRelationLevel=-1（无关系）
      if (Number(data?.status) === 200) return { ok: true }
      return { ok: false, reason: data?.msg || `status=${data?.status}` }
    }
  }
}

/**
 * 通用写操作执行器。
 * @param {string} name  - ACTIONS 里的 key
 * @param {object} params - 业务参数
 * @param {string} cookie - 已登录 cookie
 * @returns {Promise<{status, data, idempotent?}>}
 *   业务成功（含幂等）：resolve
 *   业务失败：reject（带 reason、internalCode、statusCode）
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

  // 基础 header 走 web 端 pcmapi 协议；actions 可以通过 headers(p) 自定义覆盖
  // 用于 App 端 mobileapi 接口（带 hupu-new-sign / hupu-encrypt-salt / x-hupu-token 等）
  const baseExtra = { cookie: cookie || '' }
  if (referer) baseExtra.referer = referer
  const customHeaders = action.headers?.(params) || {}
  const headers = { ...BASE_HEADERS, ...baseExtra, ...customHeaders }

  const response = await axios({ method, url, data, headers })
  const body = response.data || {}

  // 业务成功判断
  const check = action.isSuccess || ((d) => (d?.code === 1 ? { ok: true } : { ok: false, reason: d?.msg || `code=${d?.code}` }))
  const result = check(body)

  if (!result.ok) {
    throw Object.assign(new Error(`${name} 失败: ${result.reason}`), {
      internalCode: body.internalCode,
      code: body.code,
      msg: body.msg,
      statusCode: response.status,
      isBusinessFailure: true
    })
  }

  return {
    status: response.status,
    data: body,
    idempotent: !!result.idempotent,
    reason: result.reason
  }
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
   * 选择器：兼容两种页面
   *   - NBA 列表（nba.hupu.com）：`.list-item a[href*="bbs.hupu.com/"]`，带 data-tid
   *   - 步行街首页（bbs.hupu.com）：`a[href*="/\d+\.html"]`（相对路径）
   * 返回：[{ tid, title, board, link }]
   */
  threads: {
    label: '抓取帖子列表',
    async run({ url = 'https://nba.hupu.com/' } = {}) {
      const res = await axios.get(url, { headers: { 'user-agent': UA }, timeout: 12000 })
      const $ = cheerio.load(res.data)
      const items = []
      const seen = new Set()

      // 1) NBA 列表：绝对路径 + data-tid
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

      // 2) 步行街首页：相对路径 /<tid>.html（如果第一种没拿到才用，避免 NBA 抓到一堆噪声）
      if (items.length === 0) {
        $('a[href]').each((_, el) => {
          const $a = $(el)
          const href = $a.attr('href') || ''
          const m = href.match(/^\/?(\d+)\.html$/)
          if (!m) return
          const tid = m[1]
          const title = $a.text().trim()
          if (tid && title && !seen.has(tid)) {
            seen.add(tid)
            items.push({ tid, title, board: '', link: href })
          }
        })
      }

      return { source: url, count: items.length, items }
    }
  },

  /**
   * 抓取某个号（按 euid）的最近**主题帖**列表（用户自己发的帖子）
   * params: { euid: string, page?: number, pageSize?: number }
   * 用 pcmapi/pc/space/v1/getThreadList
   * 返回：[{ tid, fid, title, puid, forum_name, createTime }]
   */
  userThreads: {
    label: '抓取某用户的主题帖',
    async run({ euid, page = 1, pageSize = 5, cookie = '' }) {
      if (!euid) throw new Error('缺少 euid')
      const url = `https://my.hupu.com/pcmapi/pc/space/v1/getThreadList?euid=${euid}&page=${page}&pageSize=${pageSize}`
      const res = await axios.get(url, {
        headers: {
          'user-agent': UA,
          ...(cookie ? { cookie } : {})
        },
        timeout: 12000
      })
      // 该接口 data 直接是数组（不是嵌套对象）
      let list = res.data?.data
      if (!Array.isArray(list)) {
        // 兼容嵌套结构
        list = list?.threadList || list?.list || list?.replyList || []
      }
      const items = (list || []).map((r) => ({
        tid: r.tid || r.threadId,
        fid: r.fid,
        topicId: r.topicId,
        title: r.title || '',
        puid: r.puid,
        forumName: r.forum_name || r.topic_name || '',
        createTime: r.create_time || null,
        formatTime: r.formatTime || r.createTimeFormat || ''
      }))
      return { euid, source: url, count: items.length, items }
    }
  },

  /**
   * 抓取某个号（按 euid）的最近**回复**列表（用户在别人帖子下的发言）
   * params: { euid: string, pageSize?: number }
   * 用 pcmapi/pc/space/v1/getReplyList（带 maxTime）
   * 返回：[{ tid, pid, puid, content, formatTime }]
   */
  userContent: {
    label: '抓取某用户的回复',
    async run({ euid, pageSize = 5, cookie = '' }) {
      if (!euid) throw new Error('缺少 euid')
      const maxTime = Date.now()
      const url = `https://my.hupu.com/pcmapi/pc/space/v1/getReplyList?euid=${euid}&maxTime=${maxTime}&page=1&pageSize=${pageSize}`
      const res = await axios.get(url, {
        headers: {
          'user-agent': UA,
          ...(cookie ? { cookie } : {})
        },
        timeout: 12000
      })
      const data = res.data?.data || {}
      const list = data.replyWithQuoteDtoList || []
      const items = list.map((r) => ({
        tid: r.tid,
        pid: r.pid,
        puid: r.puid,
        topicId: r.topicId, // 举报接口要传，不带会被虎扑当「话题不存在」拒绝
        content: stripHtml(r.content || ''),
        formatTime: r.formatTime || ''
      }))
      return { euid, source: url, count: items.length, items }
    }
  },

  /**
   * 抓取 NBA 资讯（ESPN JSON API + Yahoo RSS 双源）
   * params: { hours?: number, maxItems?: number, includeMedia?: boolean }
   * 默认：48 小时内最多 15 条；过滤掉纯集锦（type=Media）
   * 返回：[{ source, title, link, description, pubDate, category, type }]
   *
   * 注：ESPN web 版 RSS (`espn.com/espn/rss/...`) 被 CloudFront WAF 拦截，
   *    改用 `site.api.espn.com` 的 JSON 端点，UA 加上完整 Chrome UA。
   *    Yahoo NBA RSS 在 redirect 后可用，会作为兜底（命中时合并）。
   */
  nbaNews: {
    label: '抓取 NBA 资讯',
    async run({ hours = 48, maxItems = 15, includeMedia = false } = {}) {
      const cutoff = Date.now() - hours * 3600 * 1000
      const all = []

      // ESPN JSON API
      try {
        const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=50'
        const res = await axios.get(url, {
          headers: { 'user-agent': UA, accept: 'application/json' },
          timeout: 12000
        })
        for (const art of res.data?.articles || []) {
          const pubTs = new Date(art.published || 0).getTime()
          const type = art.type || ''
          // 默认过滤纯集锦；想保留就传 includeMedia
          if (!includeMedia && type === 'Media') continue
          if (!Number.isFinite(pubTs) || pubTs < cutoff) continue
          const cat = (art.categories || [])[0] || {}
          all.push({
            source: 'espn-api',
            title: String(art.headline || '').trim(),
            link: art.links?.web?.href || '',
            description: stripHtml(art.description || '').slice(0, 400),
            pubDate: art.published,
            pubTs,
            category: cat.description || cat.type || '',
            type
          })
        }
      } catch (e) {
        console.error('[nbaNews] ESPN API 抓取失败:', e.message)
      }

      // Yahoo NBA RSS 兜底（被 redirect 后才给 XML；不强制依赖）
      try {
        const url = 'https://sports.yahoo.com/nba/rss.xml'
        const res = await axios.get(url, {
          headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, */*' },
          timeout: 12000,
          maxRedirects: 5
        })
        const $ = cheerio.load(res.data, { xmlMode: true })
        $('item').each((_, el) => {
          const $item = $(el)
          const pubStr = $item.find('pubDate').text().trim()
          const pubTs = new Date(pubStr).getTime()
          if (!Number.isFinite(pubTs) || pubTs < cutoff) return
          all.push({
            source: 'yahoo-rss',
            title: $item.find('title').text().trim(),
            link: $item.find('link').text().trim(),
            description: stripHtml($item.find('description').text()).slice(0, 400),
            pubDate: pubStr,
            pubTs,
            category: $item.find('category').first().text().trim(),
            type: 'rss'
          })
        })
      } catch (e) {
        console.error('[nbaNews] Yahoo RSS 抓取失败:', e.message)
      }

      // 按时间倒序，去重（title 完全相同视为同一则）
      all.sort((a, b) => b.pubTs - a.pubTs)
      const seen = new Set()
      const dedup = []
      for (const it of all) {
        const key = it.title.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        dedup.push(it)
      }

      return {
        cutoffIso: new Date(cutoff).toISOString(),
        totalFetched: all.length,
        count: dedup.length,
        items: dedup.slice(0, maxItems)
      }
    }
  },

  /**
   * 抓取 AI Agent 论文/报告（arXiv + HN + 公司博客）
   * params: { days?: number, maxItems?: number }
   * 默认：过去 7 天，最多 30 条（去重后）
   * 返回：[{ source, title, abstract, link, pubTs, direction?, authors?, points?, ... }]
   *
   * 4 个方向关键词组合：
   *   - multi-agent（多 Agent 协作/通信/失败恢复）
   *   - context（上下文管理/记忆/长任务状态）
   *   - local（本地 LLM / Agent runtime / 工具调用）
   *   - sandbox（执行隔离/权限/容器/可复现环境）
   */
  aiPapers: {
    label: '抓取 AI Agent 论文/报告',
    async run({ days = 7, maxItems = 30 } = {}) {
      const cutoffMs = Date.now() - days * 86400 * 1000
      const all = []

      // 1. arXiv：4 个方向各拉 12 篇
      const ARXIV_QUERIES = [
        { tag: 'multi-agent', q: 'all:%22multi-agent%22+AND+(all:collaboration+OR+all:coordination+OR+all:communication)' },
        { tag: 'context', q: '(all:%22context+management%22+OR+all:memory+OR+all:%22long-context%22)+AND+all:agent' },
        { tag: 'local', q: '(all:%22local+LLM%22+OR+all:%22agent+runtime%22+OR+all:%22tool+use%22)+AND+all:agent' },
        { tag: 'sandbox', q: '(all:sandbox+OR+all:isolation+OR+all:%22code+execution%22)+AND+all:agent' }
      ]
      for (const { tag, q } of ARXIV_QUERIES) {
        try {
          const url = `http://export.arxiv.org/api/query?search_query=${q}&max_results=12&sortBy=submittedDate&sortOrder=descending`
          const res = await axios.get(url, {
            headers: { 'user-agent': UA },
            timeout: 15000,
            maxRedirects: 5
          })
          const $ = cheerio.load(res.data, { xmlMode: true })
          $('entry').each((_, el) => {
            const $e = $(el)
            const idText = $e.find('id').text().trim()
            const arxivId = idText.split('/').pop() || idText
            const pubStr = $e.find('published').text().trim()
            const pubTs = new Date(pubStr).getTime()
            if (!Number.isFinite(pubTs) || pubTs < cutoffMs) return
            all.push({
              source: 'arxiv',
              arxivId,
              direction: tag,
              title: $e.find('title').text().trim().replace(/\s+/g, ' '),
              abstract: $e.find('summary').text().trim().replace(/\s+/g, ' ').slice(0, 800),
              authors: $e.find('author name').map((_, a) => $(a).text().trim()).get().slice(0, 4),
              primaryCategory: $e.find('category').first().attr('term') || '',
              link: idText,
              pdfLink: $e.find('link[title="pdf"]').attr('href') || '',
              pubTs
            })
          })
        } catch (e) {
          console.error('[aiPapers] arxiv 抓取失败', tag, e.message)
        }
      }

      // 2. HN Algolia：AI agent 相关热帖（社区投票 = 质量信号）
      const HN_QUERIES = ['AI agent', 'LLM agent', 'multi-agent']
      for (const q of HN_QUERIES) {
        try {
          const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i%3E${Math.floor(cutoffMs / 1000)}&hitsPerPage=10`
          const res = await axios.get(url, {
            headers: { 'user-agent': UA },
            timeout: 12000
          })
          for (const h of res.data?.hits || []) {
            const ts = h.created_at_i ? h.created_at_i * 1000 : 0
            if (ts < cutoffMs) continue
            all.push({
              source: 'hn',
              hnId: h.objectID,
              direction: q,
              title: h.title || h.story_title || '',
              abstract: (h._tags?.includes('comment_text') ? '' : '') + (h.url || ''),
              url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
              link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
              points: h.points || 0,
              comments: h.num_comments || 0,
              pubTs: ts
            })
          }
        } catch (e) {
          console.error('[aiPapers] HN 抓取失败', q, e.message)
        }
      }

      // 3. OpenAI News RSS
      try {
        const res = await axios.get('https://openai.com/news/rss.xml', {
          headers: { 'user-agent': UA },
          timeout: 12000
        })
        const $ = cheerio.load(res.data, { xmlMode: true })
        $('item').slice(0, 8).each((_, el) => {
          const $e = $(el)
          const pubStr = $e.find('pubDate').text().trim()
          const ts = new Date(pubStr).getTime()
          if (!Number.isFinite(ts) || ts < cutoffMs) return
          const link = $e.find('link').text().trim()
          all.push({
            source: 'openai-blog',
            title: $e.find('title').text().trim(),
            abstract: stripHtml($e.find('description').text()).slice(0, 600),
            link,
            pubTs: ts
          })
        })
      } catch (e) {
        console.error('[aiPapers] OpenAI blog 抓取失败:', e.message)
      }

      // 4. DeepMind Blog RSS（响应是 gzip，axios 自动解压）
      try {
        const res = await axios.get('https://deepmind.google/blog/rss.xml', {
          headers: { 'user-agent': UA },
          timeout: 12000,
          decompress: true
        })
        const $ = cheerio.load(res.data, { xmlMode: true })
        $('item').slice(0, 8).each((_, el) => {
          const $e = $(el)
          const pubStr = $e.find('pubDate').text().trim()
          const ts = new Date(pubStr).getTime()
          if (!Number.isFinite(ts) || ts < cutoffMs) return
          const link = $e.find('link').text().trim()
          all.push({
            source: 'deepmind-blog',
            title: $e.find('title').text().trim(),
            abstract: stripHtml($e.find('description').text()).slice(0, 600),
            link,
            pubTs: ts
          })
        })
      } catch (e) {
        console.error('[aiPapers] DeepMind blog 抓取失败:', e.message)
      }

      // 去重：按 title 小写做 key
      const seen = new Set()
      const dedup = []
      for (const it of all) {
        const key = (it.title || '').toLowerCase().trim().slice(0, 80)
        if (!key || seen.has(key)) continue
        seen.add(key)
        dedup.push(it)
      }
      // 按时间倒序
      dedup.sort((a, b) => (b.pubTs || 0) - (a.pubTs || 0))

      return {
        cutoffIso: new Date(cutoffMs).toISOString(),
        totalFetched: all.length,
        count: dedup.length,
        items: dedup.slice(0, maxItems)
      }
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

