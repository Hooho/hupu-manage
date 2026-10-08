import express from 'express'
import cors from 'cors'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { executeAction, executeScraper, ACTIONS, SCRAPERS } from './operations.js'
import { getTaskStates, getBoard, runTask, setTaskConfig, startScheduler } from './scheduler.js'
import { readAccounts, addAccount, removeAccount, updateAccount, getAccount, getPrimaryCookie, setPrimaryAccount } from './storage.js'
import { generateHupuReply, listProviders } from './ai.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = 3002

app.use(cors())
app.use(express.json())

const DATA_DIR = path.join(__dirname, 'data')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
const USERS_FILE = path.join(DATA_DIR, 'users.json')
const OPERATIONS_FILE = path.join(DATA_DIR, 'operations.json')
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json')
const STATS_FILE = path.join(DATA_DIR, 'stats.json')

// 确保数据目录存在
await fs.mkdir(DATA_DIR, { recursive: true })

// 读取配置
async function readConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return { cookie: '', euids: [] }
  }
}

// 保存配置
async function saveConfig(config) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2))
}

// 读取用户数据
async function readUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

// 保存用户数据
async function saveUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2))
}

// 读取操作记录
async function readOperations() {
  try {
    const data = await fs.readFile(OPERATIONS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

// 保存操作记录
async function saveOperation(operation) {
  const operations = await readOperations()
  operations.push({ ...operation, timestamp: Date.now() })
  await fs.writeFile(OPERATIONS_FILE, JSON.stringify(operations, null, 2))
}

// 读取浏览进度
async function readProgress() {
  try {
    const data = await fs.readFile(PROGRESS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

// 保存浏览进度
async function saveProgress(progress) {
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2))
}

// 读取统计数据
async function readStats() {
  try {
    const data = await fs.readFile(STATS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

// 保存统计数据
async function saveStats(stats) {
  await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2))
}

// 计算 maxTime
function calculateMaxTime() {
  return Math.floor(Date.now() / 1000)
}

// 获取配置
app.get('/api/config', async (req, res) => {
  const config = await readConfig()
  res.json(config)
})

// App 端 mobileapi 接口的 session 配置（4 个 app 操作共用一套配置结构）
app.get('/api/app-sessions', async (req, res) => {
  const config = await readConfig()
  res.json(config.appSessions || {})
})

// 更新单个 session
// body: { label?, host?, userAgent?, hupuNewSign?, hupuEncryptSalt?, xHupuToken?, cookie? }
// 只覆盖传的字段，其他保持原值
app.put('/api/app-sessions/:key', async (req, res) => {
  const { key } = req.params
  const config = await readConfig()
  if (!config.appSessions || !config.appSessions[key]) {
    return res.status(404).json({ error: `未知 session: ${key}` })
  }
  // 白名单字段，避免外部塞额外字段污染 config
  const ALLOWED = ['label', 'host', 'userAgent', 'hupuNewSign', 'hupuEncryptSalt', 'xHupuToken', 'cookie']
  const patch = {}
  for (const k of ALLOWED) {
    if (req.body[k] !== undefined) patch[k] = String(req.body[k])
  }
  config.appSessions[key] = { ...config.appSessions[key], ...patch }
  await saveConfig(config)
  res.json({ ok: true, session: config.appSessions[key] })
})

// 保存配置
app.post('/api/config', async (req, res) => {
  await saveConfig(req.body)

  // 同步更新用户列表
  const users = await readUsers()
  const existingEuids = new Set(users.map(u => u.euid))

  for (const euid of req.body.euids) {
    if (!existingEuids.has(euid)) {
      users.push({ euid })
    }
  }

  // 移除不在配置中的用户
  const filteredUsers = users.filter(u => req.body.euids.includes(u.euid))
  await saveUsers(filteredUsers)

  res.json({ success: true })
})

// AI providers 列表（前端下拉框用）
app.get('/api/ai/providers', (req, res) => {
  res.json({ providers: listProviders() })
})

// 生成单条 AI 评论（手动测试用）
app.post('/api/ai/generate', async (req, res) => {
  try {
    const config = await readConfig()
    const text = await generateHupuReply({ config })
    res.json({ success: true, content: text })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

// 预览「每日自动发帖」AI 生成结果（不真发帖）
// 抓 AI Papers 候选 + 调度层硬选 1 篇 + writer 5 段式事实摘要
app.post('/api/preview/thread', async (req, res) => {
  try {
    const config = await readConfig()
    if (!config.ai?.provider || !config.ai?.apiKey) {
      return res.status(400).json({ success: false, error: '未配置 AI provider + apiKey' })
    }
    const { executeScraper } = await import('./operations.js')
    const { recentClassicTopics } = await import('./storage.js')
    const { writePaperPost } = await import('./ai.js')

    let candidates = []
    try {
      const r = await executeScraper('aiPapers', { days: 7, maxItems: 40 })
      candidates = r.items || []
    } catch (e) {
      // 抓失败也能继续
    }
    const usedTitles = await recentClassicTopics(50)
    const usedSet = new Set(usedTitles.map((t) => t.toLowerCase().trim().slice(0, 60)))
    const seen = new Set()
    const fresh = []
    for (const c of candidates) {
      const key = (c.title || '').toLowerCase().trim().slice(0, 60)
      if (!key || usedSet.has(key) || seen.has(key)) continue
      seen.add(key)
      fresh.push(c)
    }
    if (fresh.length === 0) {
      return res.json({ success: false, error: '没有未发过的新候选' })
    }
    const paper = fresh[0]
    const out = await writePaperPost({ config, paper })
    res.json({
      success: true,
      candidatesCount: candidates.length,
      freshCount: fresh.length,
      usedTitlesCount: usedTitles.length,
      ...out
    })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

// 获取单个用户的回帖列表
app.get('/api/replies/:euid', async (req, res) => {
  try {
    const { euid } = req.params
    const cookie = await getPrimaryCookie()

    if (!cookie) {
      return res.status(400).json({ error: '请先在「账号」tab 配置主账号 Cookie' })
    }

    const progress = await readProgress()
    const users = await readUsers()
    const userInfo = users.find(u => u.euid === euid) || { euid }

    const userProgress = progress[euid] || { page: 1, maxTime: calculateMaxTime() }
    const page = parseInt(req.query.page) || userProgress.page
    const pageSize = 50

    // 如果请求第一页，使用当前时间戳；否则使用保存的 maxTime
    const maxTime = page === 1 ? calculateMaxTime() : userProgress.maxTime

    const url = `https://my.hupu.com/pcmapi/pc/space/v1/getReplyList?euid=${euid}&maxTime=${maxTime}&page=${page}&pageSize=${pageSize}`

    console.log(`请求第${page}页，使用maxTime: ${maxTime}`)

    const response = await axios.get(url, {
      headers: {
        'cookie': cookie,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    })

    if (response.data.code === 1 && response.data.data) {
      const replies = response.data.data.replyWithQuoteDtoList || []
      const hasNext = response.data.data.nextPage || false
      const newMaxTime = response.data.data.maxTime || maxTime

      // 给每条 reply 标 submitted / submitCount：是否已提交过 + 提交次数
      // 兼容老数据：op.submitted === true（新格式）|| op.status === 'success'（旧格式）
      // 仅作 UI 展示用，不影响接口逻辑（不影响是否能再次举报）
      const operations = await readOperations()
      const submitCountMap = new Map() // pid -> 成功提交次数
      for (const op of operations) {
        if (op.submitted === true || op.status === 'success') {
          const id = op.id
          submitCountMap.set(id, (submitCountMap.get(id) || 0) + 1)
        }
      }
      const repliesWithStatus = replies.map((r) => {
        const count = submitCountMap.get(r.pid) || 0
        return {
          ...r,
          submitted: count > 0,
          submitCount: count
        }
      })

      console.log(`第${page}页返回，新的maxTime: ${newMaxTime}`)

      res.json({
        euid,
        username: userInfo.username || repliesWithStatus[0]?.username || euid,
        userInfo,
        page,
        hasNext,
        maxTime: newMaxTime,
        replies: repliesWithStatus
      })
    } else {
      res.status(400).json({ error: '获取数据失败' })
    }
  } catch (error) {
    console.error(`获取用户数据失败:`, error.message)
    res.status(500).json({ error: error.message })
  }
})

// 举报接口（使用主账号 cookie）
app.post('/api/report', async (req, res) => {
  try {
    const cookie = await getPrimaryCookie()
    if (!cookie) return res.status(400).json({ error: '未配置主账号 Cookie' })
    const { data } = await executeAction('report', req.body, cookie)
    console.log('举报成功:', data)
    res.json({ success: true, data, status: 'success' })
  } catch (error) {
    console.error('举报失败:', error.response?.data || error.message)
    res.status(error.response?.status || 500).json({
      error: error.message,
      details: error.response?.data,
      status: 'failed'
    })
  }
})

// 通用操作 endpoint
// body 透传给对应 action 的 body builder
// 例：POST /api/action/recommend  body={tid, fid, status: 1|0}
app.post('/api/action/:name', async (req, res) => {
  const name = req.params.name
  if (!ACTIONS[name]) {
    return res.status(404).json({ error: `未知操作: ${name}` })
  }
  try {
    const cookie = await getPrimaryCookie()
    if (!cookie) return res.status(400).json({ error: '未配置主账号 Cookie' })
    // App 端 mobileapi 接口需要从 config.appSessions 读 session-level 固定 header
    // 按 action key 取（reply/follow/share），抓包一次后填进 config.json
    const config = await readConfig()
    const params = {
      ...req.body,
      _appSessions: config.appSessions || {},
      _appFollowConfig: config.appFollowConfig || {}
    }
    const { data, idempotent, reason } = await executeAction(name, params, cookie)
    console.log(`${ACTIONS[name].label} ${idempotent ? '幂等' : '成功'}:`, data, idempotent ? `(reason: ${reason})` : '')
    res.json({
      success: true,
      idempotent: !!idempotent,
      reason: reason || null,
      data,
      status: idempotent ? 'idempotent' : 'success'
    })
  } catch (error) {
    console.error(`${ACTIONS[name].label} 失败:`, error.response?.data || error.message)
    res.status(error.response?.status || 500).json({
      error: error.message,
      details: error.response?.data,
      status: 'failed'
    })
  }
})

// 抓取端点（GET + cheerio 解析）
// 例：POST /api/scrape/threads body={url?} → 帖子列表
//     POST /api/scrape/replies body={tid}  → 单帖评论
//     POST /api/scrape/nba-news body={hours?, maxItems?}  → NBA RSS（URL 用 kebab，对应 SCRAPERS.nbaNews）
app.post('/api/scrape/:name', async (req, res) => {
  // kebab → camel（URL 友好，内部保持 camelCase）
  const rawName = req.params.name
  const name = rawName.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  if (!SCRAPERS[name]) {
    return res.status(404).json({ error: `未知抓取器: ${name}` })
  }
  try {
    const result = await executeScraper(name, req.body || {})
    res.json({ success: true, ...result })
  } catch (error) {
    console.error(`${SCRAPERS[name].label} 失败:`, error.message)
    res.status(error.status || 500).json({
      error: error.message,
      success: false
    })
  }
})

// 保存操作记录
app.post('/api/save-operation', async (req, res) => {
  try {
    await saveOperation(req.body)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 保存浏览进度
app.post('/api/save-progress', async (req, res) => {
  try {
    const progress = await readProgress()
    const { euid, page, maxTime } = req.body
    console.log(`保存进度 - euid: ${euid}, page: ${page}, maxTime: ${maxTime}`)
    progress[euid] = { page, maxTime }
    await saveProgress(progress)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 获取用户列表
app.get('/api/users', async (req, res) => {
  const users = await readUsers()
  res.json(users)
})

// 抓取用户主页信息
app.post('/api/fetch-user-info', async (req, res) => {
  try {
    const { euid } = req.body
    const cookie = await getPrimaryCookie()

    const url = `https://my.hupu.com/${euid}?tabKey=2`

    const response = await axios.get(url, {
      headers: {
        'cookie': cookie,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    })

    const $ = cheerio.load(response.data)

    // 用户名：title 下的 h2 标签
    const username = $('.title h2').text().trim() || `用户${euid}`

    // 统计数据：tabListWarp 下的 tabItem
    let replyCount = '-'
    let recommendCount = '-'
    let postCount = '-'

    $('.tabListWarp .tabItem').each((i, elem) => {
      const nameElem = $(elem).find('.nameStyle')
      const numElem = $(elem).find('.numValueStyle')

      if (nameElem.length > 0 && numElem.length > 0) {
        const name = nameElem.text().trim()
        const num = numElem.text().trim()

        if (name === '回帖' && num) {
          replyCount = num
        } else if (name === '推荐' && num) {
          recommendCount = num
        } else if (name === '发贴' && num) {
          postCount = num
        }
      }
    })

    // 声望值：tagTitleList 的最后一个 tagItem 里的数字
    let reputation = '-'
    const tagTitleList = $('.tagTitleList')
    if (tagTitleList.length > 0) {
      const lastTagItem = tagTitleList.find('.tagItem').last()
      if (lastTagItem.length > 0) {
        const text = lastTagItem.text()
        const match = text.match(/\d+/)
        if (match) {
          reputation = match[0]
        }
      }
    }

    const users = await readUsers()
    const userIndex = users.findIndex(u => u.euid === euid)

    const userData = {
      euid,
      username,
      replyCount,
      recommendCount,
      postCount,
      reputation,
      lastUpdate: new Date().toISOString()
    }

    if (userIndex >= 0) {
      users[userIndex] = { ...users[userIndex], ...userData }
    } else {
      users.push(userData)
    }

    await saveUsers(users)

    console.log('抓取成功:', userData)
    res.json({ success: true, data: userData })
  } catch (error) {
    console.error('抓取用户信息失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 获取举报结果
app.post('/api/report-results', async (req, res) => {
  try {
    const { page = 1 } = req.body
    const cookie = await getPrimaryCookie()

    if (!cookie) {
      return res.status(400).json({ error: '请先配置主账号 Cookie' })
    }

    const response = await axios.post('https://my.hupu.com/pcmapi/pc/space/v1/pm/getPmDetail', {
      fromPuid: 16243921, // 虎扑站务组
      page: {
        pageNum: page,
        pageSize: 50
      }
    }, {
      headers: {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        'content-type': 'application/json;charset=UTF-8',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'cookie': cookie,
        'referer': 'https://my.hupu.com/personalMessage',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
      }
    })

    if (response.data.code === 1 && response.data.data) {
      const results = response.data.data.pmDetailList.map(item => {
        // 判断是否举报成功
        const isSuccess = item.content.includes('个人声望：+1（单日奖励上限为10声望）')

        // 提取关键评论内容
        let quotedContent = ''
        const match1 = item.content.match(/你对回复[''](.+?)['']的举报/)
        const match2 = item.content.match(/已收到你对回帖\\"(.+?)\\"的反馈/)

        if (match1) {
          quotedContent = match1[1]
        } else if (match2) {
          quotedContent = match2[1]
        }

        return {
          pmid: item.pmid,
          content: quotedContent || item.content.substring(0, 100),
          fullContent: item.content,
          createTime: item.createTime,
          isSuccess,
          nickName: item.nickName
        }
      })

      res.json({
        results,
        page: response.data.data.page
      })
    } else {
      res.status(400).json({ error: '获取举报结果失败' })
    }
  } catch (error) {
    console.error('获取举报结果失败:', error.response?.data || error.message)
    res.status(500).json({ error: error.message })
  }
})

// 统计举报结果
app.post('/api/fetch-report-stats', async (req, res) => {
  try {
    const cookie = await getPrimaryCookie()

    if (!cookie) {
      return res.status(400).json({ error: '请先配置主账号 Cookie' })
    }

    // 获取所有举报结果
    let page = 1
    let hasMore = true
    const allReports = []

    console.log('开始获取举报结果...')

    while (hasMore) {
      try {
        const response = await axios.post('https://my.hupu.com/pcmapi/pc/space/v1/pm/getPmDetail', {
          fromPuid: 16243921, // 虎扑站务组
          page: {
            pageNum: page,
            pageSize: 30
          }
        }, {
          headers: {
            'accept': '*/*',
            'content-type': 'application/json;charset=UTF-8',
            'cookie': cookie,
            'referer': 'https://my.hupu.com/personalMessage',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          }
        })

        if (response.data.code === 1 && response.data.data) {
          const pmList = response.data.data.pmDetailList || []

          pmList.forEach(item => {
            // 判断是否举报成功
            const isSuccess = item.content.includes('个人声望：+1（单日奖励上限为10声望）')

            allReports.push({
              content: item.content,
              createTime: item.createTime,
              isSuccess
            })
          })

          console.log(`已获取第 ${page} 页，共 ${pmList.length} 条记录`)

          // 检查是否还有下一页
          const pageInfo = response.data.data.page
          hasMore = pageInfo && pageInfo.pageNum < pageInfo.totalPage
          page++

          // 添加延迟避免请求过快
          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        } else {
          hasMore = false
        }
      } catch (error) {
        console.error(`获取第 ${page} 页失败:`, error.message)
        hasMore = false
      }
    }

    console.log(`总共获取 ${allReports.length} 条举报记录`)

    // 获取今天和昨天的日期
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const todayTimestamp = today.getTime() / 1000
    const yesterdayTimestamp = yesterday.getTime() / 1000

    // 统计今天和昨天的数据
    const todayStats = { totalCount: 0, successCount: 0, failCount: 0 }
    const yesterdayStats = { totalCount: 0, successCount: 0, failCount: 0 }

    allReports.forEach(report => {
      const reportDate = new Date(report.createTime * 1000)
      const reportDateStart = new Date(reportDate.getFullYear(), reportDate.getMonth(), reportDate.getDate())
      const reportTimestamp = reportDateStart.getTime() / 1000

      if (reportTimestamp >= todayTimestamp) {
        // 今天
        todayStats.totalCount++
        if (report.isSuccess) {
          todayStats.successCount++
        } else {
          todayStats.failCount++
        }
      } else if (reportTimestamp >= yesterdayTimestamp && reportTimestamp < todayTimestamp) {
        // 昨天
        yesterdayStats.totalCount++
        if (report.isSuccess) {
          yesterdayStats.successCount++
        } else {
          yesterdayStats.failCount++
        }
      }
    })

    // 保存统计结果
    const statsData = {
      lastUpdate: new Date().toISOString(),
      today: todayStats,
      yesterday: yesterdayStats
    }
    await saveStats(statsData)

    console.log('统计完成:', { today: todayStats, yesterday: yesterdayStats })
    res.json({
      success: true,
      today: todayStats,
      yesterday: yesterdayStats
    })
  } catch (error) {
    console.error('统计举报结果失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// 获取已保存的统计数据
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await readStats()
    res.json(stats)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ===========================================================
   调度器 API
   =========================================================== */
app.get('/api/accounts', async (req, res) => {
  const list = await readAccounts()
  // 隐藏 cookie 字段，只返回前 12 位 + ...
  const masked = list.map((a) => ({
    ...a,
    cookie: a.cookie ? `${a.cookie.slice(0, 12)}...${a.cookie.slice(-8)}` : ''
  }))
  res.json({ accounts: masked })
})

app.post('/api/accounts', async (req, res) => {
  try {
    const account = await addAccount(req.body || {})
    res.json({ success: true, account: { ...account, cookie: '***' } })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.patch('/api/accounts/:id', async (req, res) => {
  const updated = await updateAccount(req.params.id, req.body || {})
  if (!updated) return res.status(404).json({ error: '账号不存在' })
  res.json({ success: true, account: { ...updated, cookie: '***' } })
})

app.delete('/api/accounts/:id', async (req, res) => {
  const list = await removeAccount(req.params.id)
  res.json({ success: true, accounts: list.map((a) => ({ ...a, cookie: '***' })) })
})

// 设为主账号（其余自动取消）
app.post('/api/accounts/:id/primary', async (req, res) => {
  try {
    const account = await setPrimaryAccount(req.params.id)
    res.json({ success: true, account: { ...account, cookie: '***' } })
  } catch (e) {
    res.status(404).json({ error: e.message })
  }
})

/* ===========================================================
   调度器 API
   =========================================================== */
app.get('/api/scheduler/tasks', (req, res) => {
  res.json({ tasks: getTaskStates() })
})

// 详情版（带 schedule / enabled / 今日是否已跑）
app.get('/api/scheduler/board', async (req, res) => {
  try {
    const tasks = await getBoard()
    res.json({ tasks })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/scheduler/run/:id', async (req, res) => {
  try {
    const force = req.body?.force || req.query.force === '1'
    const retryOnly = req.body?.retryOnly || req.query.retryOnly === '1'
    const out = await runTask(req.params.id, { force, retryOnly })
    res.json({ success: true, ...out })
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message })
  }
})

app.patch('/api/scheduler/task/:id', async (req, res) => {
  try {
    const {
      enabled,
      schedule,
      // 任务专属配置（目前 daily-post-content 用）
      accountIds,
      postsPerAccount,
      fid
    } = req.body || {}
    const patch = {}
    if (typeof enabled === 'boolean') patch.enabled = enabled
    if (typeof schedule === 'string' && /^\d{2}:\d{2}$/.test(schedule)) {
      patch.schedule = schedule
    }
    if (Array.isArray(accountIds)) {
      patch.accountIds = accountIds.filter((x) => typeof x === 'string')
    }
    if (typeof postsPerAccount === 'number' && Number.isFinite(postsPerAccount)) {
      patch.postsPerAccount = Math.max(1, Math.min(5, Math.floor(postsPerAccount)))
    }
    if (typeof fid === 'number' && Number.isFinite(fid) && fid > 0) {
      patch.fid = Math.floor(fid)
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({
        error:
          '需要 enabled:boolean / schedule:HH:MM / accountIds:string[] / postsPerAccount:number(1-5) / fid:number 至少一个'
      })
    }
    const r = await setTaskConfig(req.params.id, patch)
    res.json({ success: true, config: r })
  } catch (error) {
    res.status(404).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  startScheduler().catch((e) => console.error('[scheduler] 启动失败:', e.message))
})
