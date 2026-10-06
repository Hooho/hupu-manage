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
 * 把 executeAction 的结果格式化成可读字符串
 *   ✓ 真成功
 *   ⚡ 幂等（reason / internalCode）
 *   ✗ 失败（reason / internalCode）
 */
function actionResult(r) {
  if (r.idempotent) {
    const why = r.data?.internalCode
      ? `${r.reason || ''} [${r.data.internalCode}]`
      : r.reason || ''
    return `⚡ 幂等${why ? `（${why}）` : ''}`
  }
  return '✓ 真成功'
}

/**
 * 单个号的"推荐 + 点赞"流程（nba.hupu.com 抓取版）
 * accounts 参数：[{id, cookie, euid}]，跑每个号
 */
async function singleAccountDailyFlow(account, log, opts = {}) {
  const { cookie, name, euid } = account
  const TARGET_LIGHTS = opts.lightTarget || 10
  const TARGET_THREADS = opts.threadTarget || 8
  const recInterval = opts.recommendInterval || 2000
  const lightInterval = opts.lightInterval || 1500

  const accName = name || `账号 ${account.id}`
  log(`▶ ${accName}（euid=${euid || '?'}）`)
  const listRes = await executeScraper('threads', { url: 'https://nba.hupu.com/' })
  const threads = (listRes.items || []).slice(0, TARGET_THREADS)
  log(`  → 抓取了 NBA 列表 ${threads.length} 条帖子`, 'info')

  let recOk = 0
  for (const t of threads) {
    const fid = Number(t.board) || 4860
    log(`  → 处理帖子 tid=${t.tid} fid=${fid} "${(t.title || '').slice(0, 30)}"`, 'info')
    try {
      const r1 = await executeAction('recommend', { tid: t.tid, fid, status: 1 }, cookie)
      log(`    推荐 状态 未→是 ${actionResult(r1)}`, r1.idempotent ? 'warn' : 'ok')
      await sleep(recInterval)
      const r2 = await executeAction('recommend', { tid: t.tid, fid, status: 0 }, cookie)
      log(`    取消推荐 状态 是→未 ${actionResult(r2)}`, r2.idempotent ? 'warn' : 'ok')
      recOk++
    } catch (e) {
      log(`  ✗ 推荐 ${t.tid} 失败: ${e.message} [${e.internalCode || ''}]`, 'err')
    }
    await sleep(1500)
  }

  let lightOk = 0
  let cursor = 0
  while (lightOk < TARGET_LIGHTS && cursor < threads.length) {
    const t = threads[cursor++]
    log(`▶ 抓取帖子 tid=${t.tid} 的评论`, 'info')
    try {
      const repRes = await executeScraper('replies', { tid: t.tid })
      const comments = repRes.items || []
      const fid = Number(t.board) || repRes.fid || 4860
      log(`  → 共抓到 ${comments.length} 条评论（已点亮 ${lightOk}/${TARGET_LIGHTS}）`, 'info')
      for (const c of comments) {
        if (lightOk >= TARGET_LIGHTS) break
        if (!c.pid || !c.puid) continue
        try {
          const lr = await executeAction(
            'light',
            { pid: c.pid, tid: t.tid, puid: c.puid, fid, deviceId: '' },
            cookie
          )
          log(
            `    点亮 pid=${c.pid} 作者=${c.username || 'uid:' + c.puid} (puid=${c.puid}) "${(c.content || '').slice(0, 30)}" → ${actionResult(lr)}`,
            lr.idempotent ? 'warn' : 'ok'
          )
          lightOk++
        } catch (e) {
          log(`    ✗ 点亮 pid=${c.pid} 失败: ${e.message} [${e.internalCode || ''}]`, 'err')
        }
        await sleep(lightInterval)
      }
    } catch (e) {
      log(`  ✗ 抓评论失败: ${e.message}`, 'err')
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
 * 号与号之间互相推荐 + 点亮
 * 配置示例（config.interact.pairs）：
 *   [{
 *     from: "A", to: "B",
 *     recommendTimes: 3,          // 给对方主题帖推荐+取消的次数
 *     lightTimes: 3,              // 给对方帖子下评论点亮+取消的次数
 *     intervalMs: 2000
 *   }]
 * 步骤（每对 from → to）：
 *   1. 抓 to 的最近 1 条**主题帖**（getThreadList）→ 拿到 (tid, fid)
 *   2. 推荐 status=1 → 取消 status=0，循环 recommendTimes 次（帖子推荐）
 *   3. 抓这条主题帖下的评论（replies scraper）→ 取第 1 条评论的 (pid, puid)
 *   4. 点亮 → 取消点亮，循环 lightTimes 次（评论点亮）
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
      log(`✗ 跳过配对 ${pair.from}→${pair.to}（账号未找到）`, 'err')
      continue
    }
    if (!to.euid) {
      log(`✗ 跳过配对 ${pair.from}→${pair.to}（目标账号缺 euid）`, 'err')
      continue
    }

    const recTimes = pair.recommendTimes ?? 3
    const lightTimes = pair.lightTimes ?? 3
    const interval = pair.intervalMs ?? 2000

    log(`▶ 配对 ${from.id} → ${to.id}（${from.name} 给 ${to.name}，euid=${to.euid}）`, 'info')

    // 1. 抓目标账号的主题帖列表（用 from 的 cookie 登录态去抓）
    let threads = []
    try {
      const t = await executeScraper('userThreads', { euid: to.euid, pageSize: 5, cookie: from.cookie })
      threads = t.items || []
      if (threads.length === 0) {
        log(`  ✗ ${to.name} 没有主题帖`, 'err')
        results.push({ pair: { from: from.id, to: to.id }, recommendOk: 0, lightOk: 0, reason: 'no thread' })
        continue
      }
      log(`  → ${from.name} 用自己的 cookie 抓取了 ${to.name} 的 ${threads.length} 条主题帖`, 'info')
    } catch (e) {
      log(`  ✗ 抓主题帖失败: ${e.message}`, 'err')
      results.push({ pair: { from: from.id, to: to.id }, recommendOk: 0, lightOk: 0, error: e.message })
      continue
    }

    const targetThread = threads[0]
    const targetTid = targetThread.tid
    const targetFid = targetThread.fid || 4860
    log(`  → 取第 1 条帖子：tid=${targetTid} fid=${targetFid} "${(targetThread.title || '').slice(0, 40)}"`, 'info')

    // 2. 推荐 → 取消 × recTimes（帖子推荐，fid 跟着帖子走）
    let recOk = 0
    for (let i = 0; i < recTimes; i++) {
      try {
        const r1 = await executeAction('recommend', { tid: targetTid, fid: targetFid, status: 1 }, from.cookie)
        log(
          `    ${from.name} 推荐 ${to.name} 的帖子 (tid=${targetTid}) ${i + 1}/${recTimes} 状态 未→是 → ${actionResult(r1)}`,
          r1.idempotent ? 'warn' : 'ok'
        )
        await sleep(interval)
        const r2 = await executeAction('recommend', { tid: targetTid, fid: targetFid, status: 0 }, from.cookie)
        log(
          `    ${from.name} 取消推荐 ${to.name} 的帖子 (tid=${targetTid}) ${i + 1}/${recTimes} 状态 是→未 → ${actionResult(r2)}`,
          r2.idempotent ? 'warn' : 'ok'
        )
        recOk++
      } catch (e) {
        log(`    ✗ ${from.name} 推荐/取消 ${i + 1}/${recTimes} 失败: ${e.message} [${e.internalCode || ''}]`, 'err')
      }
      await sleep(1500)
    }

    // 3. 抓这条主题帖下的评论（取第 1 条）
    let replyItems = []
    let allReplies = []
    try {
      const r = await executeScraper('replies', { tid: targetTid, cookie: from.cookie })
      allReplies = r.items || []
      replyItems = allReplies.slice(0, 1)
      log(
        `  → ${from.name} 抓取了 ${to.name} 帖子下的 ${allReplies.length} 条评论，取第 1 条`,
        'info'
      )
    } catch (e) {
      log(`  ✗ 抓评论失败: ${e.message}`, 'err')
    }

    // 4. 点亮 → 取消点亮 × lightTimes（评论，pid 走 reply 的 id，puid 走 reply 作者 uid）
    let lightOk = 0
    if (replyItems.length > 0) {
      const reply = replyItems[0]
      const targetPid = reply.pid
      const targetPuid = reply.puid
      log(
        `  → 评论：pid=${targetPid} 作者=${reply.username || '匿名'} (uid=${reply.puid}) "${(reply.content || '').slice(0, 40)}"`,
        'info'
      )
      for (let i = 0; i < lightTimes; i++) {
        // 拆成两个 try 块：light 失败和 unlight 失败分开记，便于排查是哪一步出错
        let lightSucceeded = false
        let unlightDone = false
        let errored = false
        try {
          const lr = await executeAction(
            'light',
            { pid: targetPid, tid: targetTid, puid: targetPuid, fid: targetFid, deviceId: '' },
            from.cookie
          )
          log(
            `    ${from.name} 点亮 ${to.name} 的评论 (pid=${targetPid}) ${i + 1}/${lightTimes} → ${actionResult(lr)}`,
            lr.idempotent ? 'warn' : 'ok'
          )
          lightSucceeded = true
          await sleep(interval)
        } catch (e) {
          errored = true
          log(`    ✗ ${from.name} 点亮 ${i + 1}/${lightTimes} 失败: ${e.message} [${e.internalCode || ''}]`, 'err')
        }
        try {
          const ur = await executeAction(
            'unlight',
            { pid: targetPid, tid: targetTid, puid: targetPuid, fid: targetFid, deviceId: '' },
            from.cookie
          )
          log(
            `    ${from.name} 取消点亮 ${to.name} 的评论 (pid=${targetPid}) ${i + 1}/${lightTimes} → ${actionResult(ur)}`,
            ur.idempotent ? 'warn' : 'ok'
          )
          unlightDone = true
        } catch (e) {
          errored = true
          log(`    ✗ ${from.name} 取消点亮 ${i + 1}/${lightTimes} 失败: ${e.message} [${e.internalCode || ''}]`, 'err')
        }

        // lightOk 只在「light 成功 + unlight 成功」时 ++，与之前语义一致
        if (lightSucceeded && unlightDone) lightOk++

        // 兜底：若本轮中途出错（不论 light 还是 unlight 失败），再 unlight 一次
        // 保证评论最终是灭状态；重复 unlight 会得到 PC090003 幂等，不算失败
        if (errored) {
          try {
            const fb = await executeAction(
              'unlight',
              { pid: targetPid, tid: targetTid, puid: targetPuid, fid: targetFid, deviceId: '' },
              from.cookie
            )
            log(`    ⚠ 兜底 unlight（保证灭状态）→ ${actionResult(fb)}`, fb.idempotent ? 'warn' : 'ok')
          } catch (e2) {
            log(`    ⚠ 兜底 unlight 也失败: ${e2.message} [${e2.internalCode || ''}]`, 'err')
          }
        }
        await sleep(interval)
      }
    } else {
      log(`  ⚠ 帖子下没评论，跳过点亮`, 'warn')
    }

    results.push({
      pair: { from: from.id, to: to.id },
      thread: { tid: targetTid, fid: targetFid, title: targetThread.title },
      recommendOk: recOk,
      lightOk
    })
  }

  log('互相操作完成', 'info')
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
  const logEntries = [] // { line, level, msg }，前端可按 level 上色
  /**
   * log(msg, level?)
   * level: 'info' | 'ok' | 'warn' | 'err'（默认 info）
   */
  const log = (msg, level = 'info') => {
    const line = `[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`
    logs.push(line)
    logEntries.push({ line, level, msg })
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
    log(`✗ 任务异常: ${e.message}`, 'err')
  }

  const finished = taskStates.get(taskId) || {}
  finished.running = false
  finished.lastResult = { result, error, logs, logEntries }
  finished.lastRunByDate = {
    date: todayKey(),
    at: new Date().toLocaleTimeString('zh-CN'),
    success: !error,
    result,
    error
  }
  taskStates.set(taskId, finished)

  return { success: !error, result, error, logs, logEntries, ranToday: hasRunToday(taskId) }
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
