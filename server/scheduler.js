// 调度器：每天定时执行任务
// 每个 task 形如：
//   {
//     id, name, description, run: async (ctx) => {}
//   }
// 调度配置（schedule / enabled）持久化在 config.taskSchedules 里，运行时动态读取
// ctx = { cookie, log, sleep(ms), accounts }
// "今日"判断：任务完成后写入 taskStates[id].lastRunByDate = { date, at, result }

import { executeAction, executeScraper } from './operations.js'
import { readConfig, readAccounts, readTaskSchedules } from './storage.js'

/* ===========================================================
   任务定义
   =========================================================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 单个号的"推荐 + 点赞"流程（nba.hupu.com 抓取版）
 * accounts 参数：[{id, cookie, euid}]，跑每个号
 */
async function singleAccountDailyFlow(account, log, opts = {}) {
  const { cookie } = account
  const TARGET_LIGHTS = opts.lightTarget || 10
  const TARGET_THREADS = opts.threadTarget || 8
  const recInterval = opts.recommendInterval || 2000
  const lightInterval = opts.lightInterval || 1500

  log(`▶ 账号 ${account.id}（${account.name || '匿名'}）`)
  const listRes = await executeScraper('threads', { url: 'https://nba.hupu.com/' })
  const threads = (listRes.items || []).slice(0, TARGET_THREADS)
  log(`  抓到 ${threads.length} 条帖子`)

  let recOk = 0
  for (const t of threads) {
    try {
      const fid = Number(t.board) || 4860
      await executeAction('recommend', { tid: t.tid, fid, status: 1 }, cookie)
      log(`  ✓ 推荐 ${t.tid} (${t.title.slice(0, 24)})`)
      await sleep(recInterval)
      await executeAction('recommend', { tid: t.tid, fid, status: 0 }, cookie)
      log(`  ✓ 取消 ${t.tid}`)
      recOk++
    } catch (e) {
      log(`  ✗ ${t.tid} 失败: ${e.message}`)
    }
    await sleep(1500)
  }

  let lightOk = 0
  let cursor = 0
  while (lightOk < TARGET_LIGHTS && cursor < threads.length) {
    const t = threads[cursor++]
    log(`▶ 抓取 ${t.tid} 评论`)
    try {
      const repRes = await executeScraper('replies', { tid: t.tid })
      const comments = repRes.items || []
      log(`  抓到 ${comments.length} 条（已点赞 ${lightOk}/${TARGET_LIGHTS}）`)
      const fid = Number(t.board) || repRes.fid || 4860
      for (const c of comments) {
        if (lightOk >= TARGET_LIGHTS) break
        if (!c.pid || !c.puid) continue
        try {
          await executeAction('light', { pid: c.pid, tid: t.tid, puid: c.puid, fid, deviceId: '' }, cookie)
          log(`  ✓ ${lightOk + 1}/${TARGET_LIGHTS} 点赞 ${c.pid} (${c.username || '匿名'})`)
          lightOk++
        } catch (e) {
          log(`  ✗ 点赞 ${c.pid} 失败: ${e.message}`)
        }
        await sleep(lightInterval)
      }
    } catch (e) {
      log(`  ✗ 抓评论失败: ${e.message}`)
    }
  }

  return { recommendOk: recOk, lightOk }
}

/**
 * 每日自动点赞（多号版）
 * 对每个 cookie 都跑一遍 singleAccountDailyFlow
 */
async function dailyPostLightTask(ctx) {
  const { accounts, log } = ctx
  const results = {}
  for (const account of accounts) {
    try {
      results[account.id] = await singleAccountDailyFlow(account, log)
    } catch (e) {
      log(`✗ 账号 ${account.id} 整体失败: ${e.message}`)
      results[account.id] = { error: e.message }
    }
  }
  log('多号完成：' + JSON.stringify(results))
  return { perAccount: results }
}

/**
 * 号与号之间互相点亮 + 推荐
 * 配置示例（config.interact.pairs）：
 *   [{ from: "A", to: "B", recommendTimes: 8, lightTimes: 8, intervalMs: 2000 }]
 * 步骤（每对 from → to）：
 *   1. 用 from.cookie，抓 to 的最近一条内容（用 SCRAPERS.userContent，按 euid）
 *      → 拿到 (tid, pid, puid)
 *   2. 给这条帖子推荐 + 取消 × recommendTimes 次
 *   3. 给这条评论点亮 × lightTimes 次（toggle）
 */
async function crossAccountInteractTask(ctx) {
  const { accounts, log } = ctx
  const config = await readConfig()
  const pairs = (config.interact && config.interact.pairs) || []
  if (pairs.length === 0) {
    log('未配置 interact.pairs，跳过')
    return { skipped: true, reason: 'no pairs configured' }
  }

  const accountById = (id) => accounts.find((a) => a.id === id)
  const results = []

  for (const pair of pairs) {
    const from = accountById(pair.from)
    const to = accountById(pair.to)
    if (!from || !to) {
      log(`✗ 跳过配对 ${pair.from}→${pair.to}（账号未找到）`)
      continue
    }
    if (!to.euid) {
      log(`✗ 跳过配对 ${pair.from}→${pair.to}（目标账号缺 euid）`)
      continue
    }

    const recTimes = pair.recommendTimes ?? 8
    const lightTimes = pair.lightTimes ?? 8
    const interval = pair.intervalMs ?? 2000

    log(`▶ 配对 ${from.id} → ${to.id}（${from.name} 给 ${to.name}）`)
    let recOk = 0
    let lightOk = 0
    let targetTid = null
    let targetPid = null
    let targetPuid = null

    // 1. 抓目标账号的内容
    try {
      const content = await executeScraper('userContent', { euid: to.euid, pageSize: 5 })
      const items = content.items || []
      if (items.length === 0) {
        log(`  ✗ ${to.id} 没有可操作的内容`)
        results.push({ pair, recommendOk: 0, lightOk: 0, reason: 'no content' })
        continue
      }
      const target = items[0]
      targetTid = target.tid
      targetPid = target.pid
      targetPuid = target.puid
      log(`  目标: tid=${targetTid} pid=${targetPid} "${target.content.slice(0, 30)}"`)
    } catch (e) {
      log(`  ✗ 抓内容失败: ${e.message}`)
      results.push({ pair, recommendOk: 0, lightOk: 0, error: e.message })
      continue
    }

    // 2. 推荐 + 取消 × recTimes
    for (let i = 0; i < recTimes; i++) {
      try {
        await executeAction('recommend', { tid: targetTid, fid: 4860, status: 1 }, from.cookie)
        log(`  ✓ 推荐 ${i + 1}/${recTimes}`)
        await sleep(interval)
        await executeAction('recommend', { tid: targetTid, fid: 4860, status: 0 }, from.cookie)
        log(`  ✓ 取消 ${i + 1}/${recTimes}`)
        recOk++
      } catch (e) {
        log(`  ✗ 推荐 ${i + 1}/${recTimes} 失败: ${e.message}`)
      }
      await sleep(1500)
    }

    // 3. 点亮 × lightTimes（toggle：light 接口是 toggle 行为）
    if (targetPid && targetPuid) {
      for (let i = 0; i < lightTimes; i++) {
        try {
          await executeAction('light', {
            pid: targetPid,
            tid: targetTid,
            puid: targetPuid,
            fid: 4860,
            deviceId: ''
          }, from.cookie)
          log(`  ✓ 点亮 ${i + 1}/${lightTimes}`)
          lightOk++
        } catch (e) {
          log(`  ✗ 点亮 ${i + 1}/${lightTimes} 失败: ${e.message}`)
        }
        await sleep(interval)
      }
    }

    results.push({ pair, recommendOk: recOk, lightOk })
  }

  log('互相操作完成')
  return { perPair: results }
}

/* ===========================================================
   任务表（任务定义；schedule / enabled 由用户在 UI 配置）
   =========================================================== */
export const TASKS = [
  {
    id: 'daily-post-light',
    name: '每日自动点赞（多号）',
    description: '抓 8 条 NBA 帖子 → 推荐+取消；跨帖子凑够 10 条评论点赞；每个号都跑一遍',
    defaultSchedule: '09:00',
    run: dailyPostLightTask
  },
  {
    id: 'cross-account-interact',
    name: '号与号互相点亮',
    description: 'A 用 A 的 cookie 去给 B 的内容反复点亮/推荐各 8 次（间隔 2 秒）',
    defaultSchedule: '15:00',
    run: crossAccountInteractTask
  }
]

/* ===========================================================
   调度引擎
   =========================================================== */
const taskStates = new Map() // id -> { running, lastRun, lastResult, nextRun, lastRunByDate }

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hasRunToday(taskId) {
  const s = taskStates.get(taskId) || {}
  const r = s.lastRunByDate
  return r && r.date === todayKey()
}

function nextRunFromHHMM(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const now = new Date()
  const next = new Date(now)
  next.setHours(h, m, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next
}

/**
 * 读任务的运行时配置（schedule / enabled），未配则用默认
 */
async function getTaskConfig(taskId, task) {
  const all = await readTaskSchedules()
  return {
    schedule: all[taskId]?.schedule || task.defaultSchedule || '09:00',
    enabled: all[taskId]?.enabled !== false
  }
}

export function getTaskStates() {
  return TASKS.map((t) => {
    const s = taskStates.get(t.id) || {}
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      schedule: t.defaultSchedule,
      enabled: true,
      running: !!s.running,
      lastRun: s.lastRun || null,
      lastResult: s.lastResult || null,
      nextRun: s.nextRun || null,
      lastRunByDate: s.lastRunByDate || null
    }
  })
}

/**
 * 详情版：读持久化 schedule / enabled、距下次多久、今日是否跑过
 */
export async function getBoard() {
  const today = todayKey()
  const result = []
  for (const t of TASKS) {
    const cfg = await getTaskConfig(t.id, t)
    const s = taskStates.get(t.id) || {}
    const todayRun =
      s.lastRunByDate && s.lastRunByDate.date === today ? s.lastRunByDate : null
    result.push({
      id: t.id,
      name: t.name,
      description: t.description,
      schedule: cfg.schedule,
      enabled: cfg.enabled,
      running: !!s.running,
      lastRun: s.lastRun || null,
      lastResult: s.lastResult || null,
      nextRun: s.nextRun || null,
      lastRunByDate: s.lastRunByDate || null,
      todayRun,
      todayKey: today,
      ranToday: !!todayRun
    })
  }
  return result
}

const timers = new Map()

export function startScheduler() {
  for (const t of TASKS) {
    scheduleTask(t)
  }
  console.log(`[scheduler] 启动，注册 ${TASKS.length} 个任务`)
}

async function scheduleTask(task) {
  const cfg = await getTaskConfig(task.id, task)
  if (!cfg.enabled) {
    console.log(`[scheduler] ${task.name} 禁用，跳过`)
    return
  }
  const next = nextRunFromHHMM(cfg.schedule)
  taskStates.set(task.id, {
    ...(taskStates.get(task.id) || {}),
    nextRun: next.toISOString(),
    schedule: cfg.schedule,
    enabled: cfg.enabled
  })
  const delay = next - new Date()
  const oldTimer = timers.get(task.id)
  if (oldTimer) clearTimeout(oldTimer)
  const timer = setTimeout(async () => {
    // 自动调度：今日已跑过则跳过本次
    if (hasRunToday(task.id)) {
      console.log(`[scheduler] ${task.name} 今日已跑过，跳过本次自动调度`)
      scheduleTask(task)
      return
    }
    await runTask(task.id)
    scheduleTask(task) // 递归
  }, delay)
  timers.set(task.id, timer)
  console.log(`[scheduler] ${task.name} → 下次执行 ${next.toLocaleString('zh-CN')}（${Math.round(delay / 1000)}s 后）`)
}

/**
 * 手动触发任务
 * @param {string} taskId
 * @param {object} opts
 * @param {boolean} opts.force - 强制跑，忽略今日已跑标志
 */
export async function runTask(taskId, opts = {}) {
  const task = TASKS.find((t) => t.id === taskId)
  if (!task) throw new Error(`未知任务: ${taskId}`)
  if (taskStates.get(taskId)?.running) {
    return { skipped: true, reason: '任务正在执行' }
  }

  if (!opts.force && hasRunToday(taskId)) {
    const last = taskStates.get(taskId).lastRunByDate
    return {
      skipped: true,
      reason: '今日已跑过',
      ranToday: true,
      todayRun: last,
      hint: '如需重新跑，请加 ?force=1'
    }
  }

  const state = taskStates.get(taskId) || {}
  state.running = true
  state.lastRun = new Date().toISOString()
  taskStates.set(taskId, state)

  const logs = []
  const log = (msg) => {
    const line = `[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`
    logs.push(line)
    console.log(`[${task.id}]`, msg)
  }

  let result = null
  let error = null
  try {
    const accounts = await readAccounts()
    const ctx = {
      cookie: accounts[0]?.cookie || '', // 向后兼容
      accounts,
      log,
      sleep
    }
    result = await task.run(ctx)
  } catch (e) {
    error = e.message
    log(`✗ 任务异常: ${e.message}`)
  }

  const finished = taskStates.get(taskId) || {}
  finished.running = false
  finished.lastResult = { result, error, logs }
  finished.lastRunByDate = {
    date: todayKey(),
    at: new Date().toLocaleTimeString('zh-CN'),
    success: !error,
    result,
    error
  }
  taskStates.set(taskId, finished)

  return { success: !error, result, error, logs, ranToday: hasRunToday(taskId) }
}

/**
 * 修改任务配置（schedule / enabled）并自动重新调度
 */
export async function setTaskConfig(taskId, patch) {
  const task = TASKS.find((t) => t.id === taskId)
  if (!task) throw new Error(`未知任务: ${taskId}`)
  const all = await readTaskSchedules()
  all[taskId] = { ...(all[taskId] || {}), ...patch }
  const { saveTaskSchedules } = await import('./storage.js')
  await saveTaskSchedules(all)
  // 重新调度
  await scheduleTask(task)
  return { id: taskId, ...all[taskId] }
}

// 兼容旧 API
export function setTaskEnabled(taskId, enabled) {
  return setTaskConfig(taskId, { enabled })
}
