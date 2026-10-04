// 调度器：每天定时执行任务
// 每个 task 形如：
//   {
//     id, name, schedule: 'HH:MM', enabled: bool, run: async (ctx) => {}
//   }
// ctx = { cookie, log, sleep(ms) }
// 注册到 TASKS 即可生效，启动时自动调度

import { executeAction, executeScraper } from './operations.js'
import { readConfig } from './storage.js'

/* ===========================================================
   任务定义
   =========================================================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 每日自动点赞
 * 步骤：
 *   1. 抓 nba.hupu.com 帖子列表
 *   2. 取前 TARGET_THREADS 条 → 点推荐（status=1）→ 取消（status=0）
 *   3. 从第一条帖子开始，跨帖子凑够 TARGET_LIGHTS 条评论逐个点赞
 *      （帖子评论不够时，自动进下一条帖子补齐）
 */
async function dailyPostLightTask(ctx) {
  const { cookie, log } = ctx
  const TARGET_LIGHTS = 10
  const TARGET_THREADS = 8

  log('▶ 抓取帖子列表')
  const listRes = await executeScraper('threads', { url: 'https://nba.hupu.com/' })
  const threads = (listRes.items || []).slice(0, TARGET_THREADS)
  log(`  抓到 ${threads.length} 条帖子`)

  // Step 2: 推荐 → 取消
  let recOk = 0
  for (const t of threads) {
    try {
      const fid = Number(t.board) || 4860
      await executeAction('recommend', { tid: t.tid, fid, status: 1 }, cookie)
      log(`  ✓ 推荐 ${t.tid} (${t.title.slice(0, 24)})`)
      await sleep(2000)
      await executeAction('recommend', { tid: t.tid, fid, status: 0 }, cookie)
      log(`  ✓ 取消 ${t.tid}`)
      recOk++
    } catch (e) {
      log(`  ✗ ${t.tid} 失败: ${e.message}`)
    }
    await sleep(1500)
  }

  // Step 3: 跨帖子凑够 TARGET_LIGHTS 条点赞
  let lightOk = 0
  let cursor = 0
  while (lightOk < TARGET_LIGHTS && cursor < threads.length) {
    const t = threads[cursor]
    cursor++
    log(`▶ 抓取 ${t.tid} 评论`)
    try {
      const repRes = await executeScraper('replies', { tid: t.tid })
      const comments = repRes.items || []
      log(`  抓到 ${comments.length} 条（已点赞 ${lightOk}/${TARGET_LIGHTS}）`)
      const fid = Number(t.board) || repRes.fid || 4860

      for (const c of comments) {
        if (lightOk >= TARGET_LIGHTS) break
        if (!c.pid || !c.puid) {
          log(`  · 跳过（缺 pid/puid）`)
          continue
        }
        try {
          await executeAction(
            'light',
            {
              pid: c.pid,
              tid: t.tid,
              puid: c.puid,
              fid,
              deviceId: ''
            },
            cookie
          )
          log(`  ✓ ${lightOk + 1}/${TARGET_LIGHTS} 点赞 ${c.pid} (${c.username || '匿名'})`)
          lightOk++
        } catch (e) {
          log(`  ✗ 点赞 ${c.pid} 失败: ${e.message}`)
        }
        await sleep(1500)
      }
    } catch (e) {
      log(`  ✗ 抓评论失败: ${e.message}`)
    }
  }

  log(`完成：推荐 ${recOk} 条，点赞 ${lightOk}/${TARGET_LIGHTS}`)
  return { recommendOk: recOk, lightOk, lightTarget: TARGET_LIGHTS }
}

/* ===========================================================
   任务表
   =========================================================== */
export const TASKS = [
  {
    id: 'daily-post-light',
    name: '每日自动点赞',
    description: '抓 8 条 NBA 帖子 → 推荐+取消；跨帖子凑够 10 条评论点赞',
    schedule: '09:00',
    enabled: true,
    run: dailyPostLightTask
  }
]

/* ===========================================================
   调度引擎
   =========================================================== */
const taskStates = new Map() // id -> { running, lastRun, lastResult, nextRun }

export function getTaskStates() {
  return TASKS.map((t) => {
    const s = taskStates.get(t.id) || {}
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      schedule: t.schedule,
      enabled: t.enabled,
      running: !!s.running,
      lastRun: s.lastRun || null,
      lastResult: s.lastResult || null,
      nextRun: s.nextRun || null
    }
  })
}

function nextRunFromHHMM(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const now = new Date()
  const next = new Date(now)
  next.setHours(h, m, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next
}

const timers = new Map()

export function startScheduler() {
  for (const t of TASKS) {
    scheduleTask(t)
  }
  console.log(`[scheduler] 启动，注册 ${TASKS.length} 个任务`)
}

function scheduleTask(task) {
  if (!task.enabled) return
  const next = nextRunFromHHMM(task.schedule)
  taskStates.set(task.id, {
    ...(taskStates.get(task.id) || {}),
    nextRun: next.toISOString()
  })
  const delay = next - new Date()
  const timer = setTimeout(async () => {
    await runTask(task.id)
    scheduleTask(task) // 递归调度下一次
  }, delay)
  timers.set(task.id, timer)
  console.log(`[scheduler] ${task.name} → 下次执行 ${next.toLocaleString('zh-CN')}（${Math.round(delay / 1000)}s 后）`)
}

export async function runTask(taskId) {
  const task = TASKS.find((t) => t.id === taskId)
  if (!task) throw new Error(`未知任务: ${taskId}`)
  if (taskStates.get(taskId)?.running) {
    return { skipped: true, reason: '任务正在执行' }
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
    const config = await readConfig()
    const ctx = {
      cookie: config.cookie,
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
  taskStates.set(taskId, finished)

  return { success: !error, result, error, logs }
}

export function setTaskEnabled(taskId, enabled) {
  const task = TASKS.find((t) => t.id === taskId)
  if (!task) throw new Error(`未知任务: ${taskId}`)
  task.enabled = enabled
  if (enabled) {
    scheduleTask(task)
  } else {
    const t = timers.get(taskId)
    if (t) clearTimeout(t)
    timers.delete(taskId)
    taskStates.set(taskId, { ...(taskStates.get(taskId) || {}), nextRun: null })
  }
  return task
}
