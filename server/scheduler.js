// 调度器：每天定时执行任务
// 每个 task 形如：
//   {
//     id, name, description, run: async (ctx) => {}
//   }
// 调度配置（schedule / enabled）持久化在 config.taskSchedules 里，运行时动态读取
// ctx = { cookie, log, sleep(ms), accounts }
// "今日"判断：任务完成后写入 taskStates[id].lastRunByDate = { date, at, result }

import { executeAction, executeScraper } from './operations.js'
import {
  readConfig,
  readAccounts,
  readTaskSchedules,
  readSchedulerLogs,
  saveSchedulerLogs,
  saveOperation,
  recentClassicTopics,
  addUsedClassic,
  hashString
} from './storage.js'
import { generateHupuReply, generateHupuThread, generateAgentDigestPost, writePaperPost } from './ai.js'

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
 * safeLight — 确保 light 操作最终真成功（state machine，不是机械 retry）
 *
 * 逻辑：
 *   1. 调 light
 *   2. 抛错（502 / 网络错误）→ retry，最多重试 maxRetries 次，每次 sleep 退避
 *   3. 返回 PC090002（已点亮过）→ 说明状态已经是亮，但这次"不算新点亮"
 *      → 先 sleep，等一会；safeUnlight 重置；再 sleep；重新尝试 light
 *      （循环里继续 retry，因为状态机还没到「真点亮」）
 *   4. 返回 code:1（真成功）→ 业务完成
 *   5. 返回其他幂等（如未知 internalCode）→ 也算成功（视为状态正确）
 *
 * @returns {Promise<object>} executeAction 的返回值
 * @throws 最终重试耗尽时抛错
 */
async function safeLight(pid, tid, puid, fid, from, label, log, maxRetries = 3) {
  const params = { pid, tid, puid, fid, deviceId: '' }
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const r = await executeAction('light', params, from.cookie)
      // PC090002 = 已点亮过，状态机不是「新点亮」。先 unlight 重置再试
      if (r.data?.internalCode === 'PC090002') {
        log(`    [${label}] light 命中 PC090002（已点亮过），先 unlight 重置再试`, 'warn')
        await sleep(2000)
        await safeUnlight(pid, tid, puid, fid, from, `${label}-reset`, log, maxRetries)
        await sleep(2000)
        continue // 重试 light
      }
      return r
    } catch (e) {
      log(`    [${label}] light 第 ${attempt}/${maxRetries} 次失败: ${e.message}`, 'warn')
      if (attempt >= maxRetries) throw e
      await sleep(2000 * attempt) // 退避：2s / 4s
    }
  }
  throw new Error(`${label} light 重试 ${maxRetries} 次仍失败`)
}

/**
 * safeUnlight — 确保 unlight 操作最终成功（PC090003 幂等也算 ok）
 *
 * 逻辑：
 *   1. 调 unlight
 *   2. 抛错 → retry，最多重试 maxRetries 次
 *   3. 返回 PC090003（未点亮过）→ 状态已经是灭，无需操作，直接 ok
 *   4. 返回 code:1 → 真成功
 *
 * @returns {Promise<object>} executeAction 的返回值
 * @throws 最终重试耗尽时抛错
 */
async function safeUnlight(pid, tid, puid, fid, from, label, log, maxRetries = 3) {
  const params = { pid, tid, puid, fid, deviceId: '' }
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const r = await executeAction('unlight', params, from.cookie)
      return r // PC090003 / code:1 都算 ok
    } catch (e) {
      log(`    [${label}] unlight 第 ${attempt}/${maxRetries} 次失败: ${e.message}`, 'warn')
      if (attempt >= maxRetries) throw e
      await sleep(2000 * attempt)
    }
  }
  throw new Error(`${label} unlight 重试 ${maxRetries} 次仍失败`)
}

/**
 * safeGenerateContent — 确保 AI 生成的内容有效（非空、>= 3 字）
 * 防御：AI 偶尔返回 "" 或只有换行/引号，会被虎扑判为「请输入回帖内容」
 */
async function safeGenerateContent(config, label, log, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const text = await generateHupuReply({ config })
    const trimmed = (text || '').trim()
    if (trimmed.length >= 3) return trimmed
    log(`    [${label}] AI 生成内容无效（空或太短：「${text}」），第 ${attempt}/${maxRetries} 次重试`, 'warn')
    if (attempt >= maxRetries) throw new Error(`${label} AI 生成内容始终无效`)
    await sleep(2000)
  }
  throw new Error('unreachable')
}

/**
 * safeGenerateThreadContent — 生成 NBA 主题帖（curator + writer，NBA 模式）
 * 返回 {title, body, kind, ref, keyPoint}；任一字段空都视为无效
 */
async function safeGenerateThreadContent(config, newsItems, usedTopics, log, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const r = await generateHupuThread({ config, newsItems, usedTopics })
      if (r && r.title && r.body && r.title.length >= 4 && r.body.length >= 20) {
        return r
      }
      log(`    AI 输出无效（第 ${attempt}/${maxRetries} 次）：${JSON.stringify(r).slice(0, 100)}`, 'warn')
    } catch (e) {
      log(`    AI 生成失败（第 ${attempt}/${maxRetries} 次）：${e.message}`, 'warn')
    }
    if (attempt < maxRetries) await sleep(3000 * attempt) // 3s / 6s 退避
  }
  throw new Error('AI 生成主题帖始终无效')
}

/**
 * safeGenerateAgentDigest — 生成 Agent digest 帖（curatorAgentDigest + writerAgentDigest）
 * candidates 是 aiPapers scraper 输出
 * usedTitles 是已用过的标题/主题（用于 curator 避免重复）
 */
async function safeGenerateAgentDigest(config, candidates, log, usedTitles = [], maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const r = await generateAgentDigestPost({ config, candidates, usedTitles })
      if (r && r.title && r.body && r.title.length >= 4 && r.body.length >= 30) {
        return r
      }
      log(`    AI 输出无效（第 ${attempt}/${maxRetries} 次）：${JSON.stringify(r).slice(0, 100)}`, 'warn')
    } catch (e) {
      log(`    AI 生成失败（第 ${attempt}/${maxRetries} 次）：${e.message}`, 'warn')
    }
    if (attempt < maxRetries) await sleep(3000 * attempt)
  }
  throw new Error('AI 生成 Agent digest 始终无效')
}

/**
 * safeWritePaperPost — 给定 paper 直接写 5 段式摘要（curator 已由调度层跳过）
 * 用于"调度层硬选"模式，保证每个 slot 拿到的是不同 paper
 */
async function safeWritePaperPost(config, paper, log, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const r = await writePaperPost({ config, paper })
      if (r && r.title && r.body && r.title.length >= 4 && r.body.length >= 30) {
        return r
      }
      log(`    AI 输出无效（第 ${attempt}/${maxRetries} 次）：${JSON.stringify(r).slice(0, 100)}`, 'warn')
    } catch (e) {
      log(`    AI 生成失败（第 ${attempt}/${maxRetries} 次）：${e.message}`, 'warn')
    }
    if (attempt < maxRetries) await sleep(3000 * attempt)
  }
  throw new Error('AI 生成 paper 摘要始终无效')
}

/**
 * 给定候选 + 总 slot 数，按候选顺序取前 N 条做不重复分配
 * 过滤掉已用过的（用 title lowercase slice 60 做 key）
 */
function pickUniquePapers(candidates, usedTitles, totalSlots) {
  const usedSet = new Set((usedTitles || []).map((t) => t.toLowerCase().trim().slice(0, 60)))
  const seen = new Set()
  const fresh = []
  for (const c of candidates || []) {
    const key = (c.title || '').toLowerCase().trim().slice(0, 60)
    if (!key || usedSet.has(key) || seen.has(key)) continue
    seen.add(key)
    fresh.push(c)
    if (fresh.length >= totalSlots) break
  }
  return fresh
}

/**
 * safeCreateReply — 确保 createReply 必须真成功才走下一步（state machine）
 * 类似 safeLight 思路：retry 3 次，必须 code:1
 */
async function safeCreateReply(params, from, label, log, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const r = await executeAction('createReply', params, from.cookie)
      return r
    } catch (e) {
      log(`    [${label}] 回复 第 ${attempt}/${maxRetries} 次失败: ${e.message} [${e.internalCode || ''}]`, 'warn')
      if (attempt >= maxRetries) throw e
      await sleep(3000 * attempt) // 退避：3s / 6s
    }
  }
  throw new Error(`${label} 回复重试 ${maxRetries} 次仍失败`)
}

/**
 * safeScrapeUserThreads — 抓主题帖，返回空时 retry 几次（应对偶发 502 或风控）
 */
async function safeScrapeUserThreads(euid, from, label, log, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const r = await executeScraper('userThreads', { euid, pageSize: 5, cookie: from.cookie })
      const items = r.items || []
      if (items.length > 0) return items
      log(`    [${label}] userThreads 返回空，第 ${attempt}/${maxRetries} 次重试`, 'warn')
    } catch (e) {
      log(`    [${label}] userThreads 第 ${attempt}/${maxRetries} 次失败: ${e.message}`, 'warn')
    }
    if (attempt >= maxRetries) return []
    await sleep(3000)
  }
  return []
}

/**
 * 单个号的"推荐 + 点赞"流程（nba.hupu.com 抓取版）
 * accounts 参数：[{id, cookie, euid}]，跑每个号
 */
async function singleAccountDailyFlow(account, log, opts = {}) {
  const { id: accountId, cookie, name, euid } = account
  const TARGET_LIGHTS = opts.lightTarget || 10
  const TARGET_THREADS = opts.threadTarget || 8
  const recInterval = opts.recommendInterval || 2000
  const lightInterval = opts.lightInterval || 1500

  const { retryOnly = false, failedSet = new Set(), newFailedActions = [] } = opts

  const accName = name || `账号 ${account.id}`
  log(`▶ ${accName}（euid=${euid || '?'}）`)
  const listRes = await executeScraper('threads', { url: 'https://nba.hupu.com/' })
  const threads = (listRes.items || []).slice(0, TARGET_THREADS)
  log(`  → 抓取了 NBA 列表 ${threads.length} 条帖子`, 'info')

  let recOk = 0
  for (let i = 0; i < threads.length; i++) {
    const t = threads[i]
    const slot = `${accountId}|recommend|${i + 1}`
    if (retryOnly && !failedSet.has(slot)) continue
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
      log(`    ✗ 推荐 ${t.tid} 失败: ${e.message} [${e.internalCode || ''}]`, 'err')
      newFailedActions.push({
        accountId,
        type: 'recommend',
        index: i + 1,
        tid: String(t.tid),
        fid,
        reason: e.message
      })
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
        const slot = `${accountId}|light|${c.pid}`
        if (retryOnly && !failedSet.has(slot)) continue
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
          newFailedActions.push({
            accountId,
            type: 'light',
            pid: String(c.pid),
            tid: String(t.tid),
            puid: String(c.puid),
            fid,
            reason: e.message
          })
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
  const { accounts, log, retryOnly, failedActions } = ctx
  if (retryOnly) {
    if (!failedActions || failedActions.length === 0) {
      log('没有失败操作，跳过', 'info')
      return { skipped: true, reason: 'no failed actions' }
    }
    log(`▶ 重跑 ${failedActions.length} 条失败操作（不重跑全部）`, 'info')
  }

  const newFailedActions = []
  // 失败位置 set：`${accountId}|${type}|${index|pid}`
  const failedSet = new Set(
    (failedActions || []).map((a) =>
      a.type === 'recommend'
        ? `${a.accountId}|recommend|${a.index}`
        : `${a.accountId}|light|${a.pid}`
    )
  )

  // 账号过滤：retryOnly 时只跑有失败项的账号
  const accountsToRun = retryOnly
    ? accounts.filter((a) => (failedActions || []).some((f) => f.accountId === a.id))
    : accounts

  const results = {}
  for (const account of accountsToRun) {
    try {
      results[account.id] = await singleAccountDailyFlow(account, log, {
        retryOnly,
        failedSet,
        newFailedActions
      })
    } catch (e) {
      log(`✗ 账号 ${account.id} 整体失败: ${e.message}`, 'err')
      results[account.id] = { error: e.message }
    }
  }
  log(
    retryOnly
      ? `重跑完成，仍失败 ${newFailedActions.length} 条`
      : `多号完成，本次失败 ${newFailedActions.length} 条`,
    newFailedActions.length > 0 ? 'warn' : 'info'
  )
  return { perAccount: results, failedActions: newFailedActions }
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
  const { accounts, log, retryOnly, failedActions } = ctx
  const config = await readConfig()
  const pairs = (config.interact && config.interact.pairs) || []
  if (pairs.length === 0) {
    log('未配置 interact.pairs，跳过')
    return { skipped: true, reason: 'no pairs configured' }
  }

  if (retryOnly) {
    if (!failedActions || failedActions.length === 0) {
      log('没有失败操作，跳过', 'info')
      return { skipped: true, reason: 'no failed actions' }
    }
    log(`▶ 重跑 ${failedActions.length} 条失败操作（不重跑全部）`, 'info')
  }

  const accountById = (id) => accounts.find((a) => a.id === id)
  const results = []
  const newFailedActions = []

  // 失败位置 set：`${pair}|${type}|${index}` → type=recommend|light
  const failedSet = new Set(
    (failedActions || []).map((a) => `${a.pair}|${a.type}|${a.index}`)
  )

  // 配对过滤
  const pairsToRun = retryOnly
    ? pairs.filter((p) =>
        (failedActions || []).some((a) => a.pair === `${p.from}→${p.to}`)
      )
    : pairs

  for (const pair of pairsToRun) {
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
    const pairKey = `${pair.from}→${pair.to}`

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
      const slot = `${pairKey}|recommend|${i + 1}`
      if (retryOnly && !failedSet.has(slot)) continue
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
        newFailedActions.push({
          pair: pairKey,
          type: 'recommend',
          index: i + 1,
          tid: String(targetTid),
          fid: Number(targetFid),
          reason: e.message
        })
      }
      await sleep(1500)
    }

    // 3. 抓 to 自己发表的回复列表（getReplyList）→ 取第 1 条
    let replyItems = []
    let allUserReplies = []
    try {
      const r = await executeScraper('userContent', { euid: to.euid, pageSize: 5, cookie: from.cookie })
      allUserReplies = r.items || []
      replyItems = allUserReplies.slice(0, 1)
      log(
        `  → ${from.name} 抓取了 ${to.name} 自己发表的 ${allUserReplies.length} 条回复，取第 1 条`,
        'info'
      )
    } catch (e) {
      log(`  ✗ 抓 ${to.name} 的回复列表失败: ${e.message}`, 'err')
    }

    // 4. 点亮 → 取消点亮 × lightTimes（评论）
    let lightOk = 0
    if (replyItems.length > 0) {
      const reply = replyItems[0]
      const targetPid = reply.pid
      const targetTid = reply.tid
      const targetPuid = reply.puid
      let targetFid = 4860
      try {
        const r = await executeScraper('replies', { tid: targetTid })
        targetFid = r.fid || 4860
      } catch (e) {
        log(`  ⚠ 拿 fid 失败（用默认 4860）: ${e.message}`, 'warn')
      }
      log(
        `  → 回复：pid=${targetPid} 来自 ${to.name} (uid=${reply.puid}) 所在帖子 tid=${targetTid} fid=${targetFid} "${(reply.content || '').slice(0, 40)}"`,
        'info'
      )
      for (let i = 0; i < lightTimes; i++) {
        const slot = `${pairKey}|light|${i + 1}`
        if (retryOnly && !failedSet.has(slot)) continue
        const cycleLabel = `${i + 1}/${lightTimes}`
        let cycleOk = false
        try {
          const lr = await safeLight(targetPid, targetTid, targetPuid, targetFid, from, cycleLabel, log)
          log(
            `    ${from.name} 点亮 ${to.name} 的回复 ${cycleLabel} → ${actionResult(lr)}`,
            lr.idempotent ? 'warn' : 'ok'
          )
          const ur = await safeUnlight(targetPid, targetTid, targetPuid, targetFid, from, cycleLabel, log)
          log(
            `    ${from.name} 取消点亮 ${to.name} 的回复 ${cycleLabel} → ${actionResult(ur)}`,
            ur.idempotent ? 'warn' : 'ok'
          )
          cycleOk = true
        } catch (e) {
          log(`    ✗ ${from.name} 点亮/取消循环 ${cycleLabel} 最终失败: ${e.message}`, 'err')
        }

        // 兜底 unlight
        try {
          const fb = await safeUnlight(
            targetPid, targetTid, targetPuid, targetFid, from, `${cycleLabel}-兜底`, log
          )
          log(`    ⚠ 兜底 unlight（保证灭状态）→ ${actionResult(fb)}`, fb.idempotent ? 'warn' : 'ok')
        } catch (e2) {
          log(`    ⚠ 兜底 unlight 也失败: ${e2.message}`, 'err')
        }

        // cycle 失败时记 failedAction（兜底不算）
        if (!cycleOk) {
          newFailedActions.push({
            pair: pairKey,
            type: 'light',
            index: i + 1,
            pid: String(targetPid),
            tid: String(targetTid),
            puid: String(targetPuid),
            fid: Number(targetFid),
            reason: 'cycle 失败'
          })
        } else {
          lightOk++
        }
        await sleep(interval)
      }
    } else {
      log(`  ⚠ ${to.name} 没有可点亮的回复（可能是抓回复列表失败或 to 没发过回复），跳过点亮`, 'warn')
    }

    results.push({
      pair: { from: from.id, to: to.id },
      thread: { tid: targetTid, fid: targetFid, title: targetThread.title },
      recommendOk: recOk,
      lightOk
    })
  }

  log(
    retryOnly
      ? `重跑完成，仍失败 ${newFailedActions.length} 条`
      : `互相操作完成，本次失败 ${newFailedActions.length} 条`,
    newFailedActions.length > 0 ? 'warn' : 'info'
  )
  return { perPair: results, failedActions: newFailedActions }
}

/**
 * 号与号互相回复（AI 生成内容）
 *
 * 每个 pair（from → to）：
 *   1. 抓 to 的主题帖列表 → 取第 1 条 → 用 AI 生成 3 条回复，逐条 createReply
 *   2. 抓首页 nba.hupu.com → 取 5 条帖子 → 每条用 AI 生成 1 条回复
 *
 * 每个号一天回 8 条（3 + 5），A↔B 互换后 A 和 B 都跑了一遍。
 *
 * 依赖：config.ai 配置（provider + apiKey）；createReply action（已存在）
 */
async function crossAccountReplyTask(ctx) {
  const { accounts, log, retryOnly, failedActions } = ctx
  const config = await readConfig()
  const pairs = (config.interact && config.interact.pairs) || []
  if (pairs.length === 0) {
    log('未配置 interact.pairs，跳过', 'warn')
    return { skipped: true, reason: 'no pairs configured' }
  }
  if (!config.ai || !config.ai.provider || !config.ai.apiKey) {
    log('未配置 AI provider + apiKey，跳过', 'err')
    return { skipped: true, reason: 'AI 未配置' }
  }

  // retryOnly 模式：只跑上次失败的 reply
  if (retryOnly) {
    if (!failedActions || failedActions.length === 0) {
      log('没有失败操作，跳过', 'info')
      return { skipped: true, reason: 'no failed actions' }
    }
    log(`▶ 重跑 ${failedActions.length} 条失败操作（不重跑全部）`, 'info')
  }

  const accountById = (id) => accounts.find((a) => a.id === id)
  const results = []
  const newFailedActions = []

  // 构造失败位置集合（用于 retryOnly 模式快速判断）
  const failedSet = new Set(
    (failedActions || []).map((a) => `${a.pair}|${a.part}|${a.index}`)
  )

  // 配对过滤：retryOnly 时只跑有失败项的 pair
  const pairsToRun = retryOnly
    ? pairs.filter((p) =>
        (failedActions || []).some(
          (a) => a.pair === `${p.from}→${p.to}`
        )
      )
    : pairs

  for (const pair of pairsToRun) {
    const from = accountById(pair.from)
    const to = accountById(pair.to)
    if (!from || !to) {
      log(`✗ 跳过配对 ${pair.from}→${pair.to}（账号未找到）`, 'err')
    }
    if (!to.euid) {
      log(`✗ 跳过配对 ${pair.from}→${pair.to}（目标账号缺 euid）`, 'err')
      continue
    }
    const pairKey = `${pair.from}→${pair.to}`

    log(`▶ ${from.name} 给 ${to.name} 回复（${pairKey}）`, 'info')
    let replyOk = 0
    const REPLY_INTERVAL = pair.replyIntervalMs ?? 5000

    // 部分 1：给 to 的主题帖回复 3 条
    let targetThread = null
    const items = await safeScrapeUserThreads(to.euid, from, '部分1抓主题帖', log)
    if (items.length === 0) {
      log(`  ✗ ${to.name} 抓不到主题帖，跳过第一部分`, 'err')
    } else {
      targetThread = items[0]
      log(`  → 取第 1 条主题帖：tid=${targetThread.tid} "${(targetThread.title || '').slice(0, 30)}"`, 'info')
      for (let i = 0; i < 3; i++) {
        const slot = `${pairKey}|1|${i + 1}`
        // retryOnly 模式：跳过没失败的
        if (retryOnly && !failedSet.has(slot)) continue
        const label = `部分1-${i + 1}/3`
        try {
          const content = await safeGenerateContent(config, label, log)
          log(`    AI 生成 ${i + 1}/3：${content}`, 'info')
          const r = await safeCreateReply(
            {
              tid: targetThread.tid,
              topicId: String(targetThread.tid),
              content,
              deviceId: ''
            },
            from,
            label,
            log
          )
          log(`    回复 ${i + 1}/3 → ${actionResult(r)}`, r.idempotent ? 'warn' : 'ok')
          replyOk++
        } catch (e) {
          log(`    ✗ 回复 ${i + 1}/3 最终失败: ${e.message}`, 'err')
          newFailedActions.push({
            pair: pairKey,
            part: 1,
            index: i + 1,
            tid: String(targetThread.tid),
            topicId: String(targetThread.tid),
            reason: e.message
          })
        }
        await sleep(REPLY_INTERVAL)
      }
    }

    // 部分 2：给首页 5 条帖子各回复 1 条
    try {
      const listRes = await executeScraper('threads', { url: 'https://nba.hupu.com/' })
      const homeThreads = (listRes.items || []).slice(0, 5)
      log(`  → 抓取首页 ${homeThreads.length} 条帖子，每条回复 1 条`, 'info')
      for (let i = 0; i < homeThreads.length; i++) {
        const t = homeThreads[i]
        const slot = `${pairKey}|2|${i + 1}`
        // retryOnly 模式：跳过没失败的
        if (retryOnly && !failedSet.has(slot)) continue
        const label = `部分2-${i + 1}/${homeThreads.length}`
        try {
          const content = await safeGenerateContent(config, label, log)
          log(`    AI 生成 ${i + 1}/${homeThreads.length}（tid=${t.tid}）：${content}`, 'info')
          const r = await safeCreateReply(
            {
              tid: t.tid,
              topicId: String(t.tid),
              content,
              deviceId: ''
            },
            from,
            label,
            log
          )
          log(`    回复 ${i + 1}/${homeThreads.length} → ${actionResult(r)}`, r.idempotent ? 'warn' : 'ok')
          replyOk++
        } catch (e) {
          log(`    ✗ 回复 ${i + 1}/${homeThreads.length} 最终失败: ${e.message}`, 'err')
          newFailedActions.push({
            pair: pairKey,
            part: 2,
            index: i + 1,
            tid: String(t.tid),
            topicId: String(t.tid),
            reason: e.message
          })
        }
        await sleep(REPLY_INTERVAL)
      }
    } catch (e) {
      log(`  ✗ 抓首页失败: ${e.message}`, 'err')
    }

    results.push({
      pair: { from: from.id, to: to.id },
      thread: targetThread ? { tid: targetThread.tid, title: targetThread.title } : null,
      replyOk
    })
  }

  log(
    retryOnly
      ? `重跑完成，仍失败 ${newFailedActions.length} 条`
      : `互相回复完成，本次失败 ${newFailedActions.length} 条`,
    newFailedActions.length > 0 ? 'warn' : 'info'
  )
  return { perPair: results, failedActions: newFailedActions }
}

/**
 * 每日自动发帖（AI Agent digest 内容，AI 生成）
 *
 * 流程：
 *   1. 抓取 aiPapers（arXiv 4 方向 + HN + OpenAI + DeepMind）→ candidates
 *   2. 读经典池（已用过的论文/主题） → baseUsedTitles
 *   3. 遍历每个选中账号 × postsPerAccount：
 *      - curatorAgentDigest 选 1 → writerAgentDigest 3段式撰写
 *      - executeAction('createThread', ...) 用该账号 cookie 发
 *      - 写 operations.json + 更新经典池（按 ref + link hash 去重）
 *      - 标题加入"本次已用"，下一次 curator 自然换主题
 *
 * 配置：config.taskSchedules['daily-post-content']
 *   - accountIds: ['A', 'B']        # 默认 [primary.id]
 *   - postsPerAccount: 1            # 每个号每天几条，默认 1（最多 5）
 *   - fid: 4860                     # 默认 NBA 区；步行街=6
 */
async function dailyPostContentTask(ctx) {
  const { accounts, log } = ctx
  const config = await readConfig()

  if (!config.ai || !config.ai.provider || !config.ai.apiKey) {
    log('未配置 AI provider + apiKey，跳过', 'err')
    return { skipped: true, reason: 'AI 未配置' }
  }

  // 读任务专属配置
  const taskCfg =
    (config.taskSchedules && config.taskSchedules['daily-post-content']) || {}

  const primary = accounts.find((a) => a.primary) || accounts[0]
  const selectedIds =
    Array.isArray(taskCfg.accountIds) && taskCfg.accountIds.length > 0
      ? taskCfg.accountIds
      : primary
      ? [primary.id]
      : []
  const postsPerAccount = Math.max(1, Math.min(5, Number(taskCfg.postsPerAccount) || 1))
  const fid = Number(taskCfg.fid) || Number(config.dailyPostContent?.fid) || 4860

  if (selectedIds.length === 0) {
    log('没有可用账号，跳过', 'err')
    return { skipped: true, reason: 'no accounts selected' }
  }

  const totalSlots = selectedIds.length * postsPerAccount
  log(`▶ 配置：${selectedIds.length} 个账号 × ${postsPerAccount} 帖/账号 = 计划 ${totalSlots} 帖（每帖必须不同），fid=${fid}`, 'info')

  // 1. 抓取候选（多抓一些保证够分）
  log('▶ 抓 AI Agent 论文/报告', 'info')
  let candidates = []
  try {
    const r = await executeScraper('aiPapers', { days: 7, maxItems: Math.max(40, totalSlots * 4) })
    candidates = r.items || []
    log(`  → 抓到 ${candidates.length} 条候选（7 天内）`, 'info')
  } catch (e) {
    log(`  ⚠ AI Papers 抓取失败: ${e.message}`, 'warn')
  }

  // 2. 过滤已用过的（跨天去重）
  const baseUsedTitles = await recentClassicTopics(50)
  log(`  → 已收录池 ${baseUsedTitles.length} 条历史`, 'info')

  // 3. 调度层硬选：按候选顺序取前 N 条，100% 不重复
  const slots = pickUniquePapers(candidates, baseUsedTitles, totalSlots)
  if (slots.length < totalSlots) {
    log(
      `  ✗ 候选不足：需要 ${totalSlots} 条不重复（已过滤已用），仅 ${slots.length} 条可发`,
      'err'
    )
    return {
      error: 'insufficient unique candidates',
      need: totalSlots,
      have: slots.length,
      accounts: selectedIds,
      postsPerAccount
    }
  }
  log(`  → 分配 ${slots.length} 个 slot（每篇不重复）`, 'info')

  let totalPosted = 0
  let totalFailed = 0

  // 4. 遍历：每个账号逐帖写
  for (let accountIdx = 0; accountIdx < selectedIds.length; accountIdx++) {
    const accountId = selectedIds[accountIdx]
    const account = accounts.find((a) => a.id === accountId)
    if (!account || !account.cookie) {
      log(`⚠ 账号 ${accountId} 不存在或无 cookie，跳过`, 'warn')
      continue
    }

    for (let i = 0; i < postsPerAccount; i++) {
      const slotIdx = accountIdx * postsPerAccount + i
      const paper = slots[slotIdx]
      if (!paper) continue

      const slot = `${account.name} 第 ${i + 1}/${postsPerAccount} 篇`
      log(`▶ [${slot}] ${(paper.title || '').slice(0, 40)}`, 'info')

      // 5. AI 写（5 段式事实摘要）
      let content
      try {
        content = await safeWritePaperPost(config, paper, log)
      } catch (e) {
        log(`  ✗ AI 生成失败: ${e.message}`, 'err')
        totalFailed++
        continue
      }
      log(`  → 标题：${content.title}`, 'info')
      if (paper.link) log(`  → 链接：${paper.link}`, 'info')

      // 6. 发帖
      log(`  → 发帖到 fid=${fid}（${account.id}）`, 'info')
      let tid = null
      let actionRes = null
      try {
        const r = await executeAction(
          'createThread',
          {
            fid: String(fid),
            title: content.title,
            content: content.body,
            shumeiId: '',
            deviceid: ''
          },
          account.cookie
        )
        actionRes = r
        tid = r.data?.data?.tid || r.data?.tid || r.data?.threadId || null
        log(`  → 发帖 ${actionResult(r)}（tid=${tid || '?'}）`, 'ok')
        totalPosted++

        await saveOperation({
          type: 'createThread',
          accountId: account.id,
          accountName: account.name,
          fid: String(fid),
          tid: tid ? String(tid) : '',
          title: content.title,
          body: content.body,
          kind: 'paper',
          ref: paper.title,
          link: paper.link || null,
          source: paper.source || null,
          keyPoint: content.keyPoint,
          submitted: true,
          status: 'success',
          response: actionRes?.data || null
        })

        // 7. 入已收录池（按 paper title + link 去重）
        const topicHash = hashString(paper.title + '|' + (paper.link || ''))
        await addUsedClassic({ topic: paper.title, hash: topicHash })
      } catch (e) {
        log(`  ✗ 发帖失败: ${e.message} [${e.internalCode || ''}]`, 'err')
        totalFailed++
        await saveOperation({
          type: 'createThread',
          accountId: account.id,
          accountName: account.name,
          fid: String(fid),
          title: content.title,
          body: content.body,
          kind: 'paper',
          ref: paper.title,
          link: paper.link || null,
          submitted: false,
          status: 'failed',
          error: e.message,
          internalCode: e.internalCode || null
        })
      }

      if (slotIdx < totalSlots - 1) await sleep(2000)
    }
  }

  log(
    totalFailed === 0
      ? `✓ 完成：成功 ${totalPosted} 帖（每帖不同 paper）`
      : `⚠ 完成：成功 ${totalPosted} 帖，失败 ${totalFailed} 帖`,
    totalFailed === 0 ? 'ok' : 'warn'
  )

  return {
    totalPosted,
    totalFailed,
    accounts: selectedIds,
    postsPerAccount,
    fid,
    uniquePapers: slots.length
  }
}

/**
 * 每日分享 N 条帖子（默认 8 条不同帖子，间隔 30 秒）
 * 抓首页/步行街最新列表 → 每条帖子 notifyShare 1 次
 * 任务专属配置（taskSchedules['daily-share-x8']）：
 *   shareCount: 分享条数（1-20，默认 8）
 *   intervalMs: 每条间隔毫秒（0-10分钟，默认 30000）
 *   url: 抓列表的 URL（默认 https://bbs.hupu.com/）
 * 依赖：notifyShare action + config.appAuth（hupu-new-sign session header）
 */
async function dailyShareTask(ctx) {
  const { log, accounts } = ctx
  const config = await readConfig()
  // 用主账号的 appSessions（per-account 配置，跟账号绑定）
  const primary = accounts.find((a) => a.primary) || accounts[0] || {}

  const taskCfg = (config.taskSchedules && config.taskSchedules['daily-share-x8']) || {}
  const count = Math.max(1, Math.min(20, Number(taskCfg.shareCount) || 8))
  const intervalMs = Math.max(0, Math.min(10 * 60_000, Number(taskCfg.intervalMs) || 30_000))
  const url = taskCfg.url || 'https://bbs.hupu.com/'

  log(`▶ 开始每日分享（${count} 条不同帖子，间隔 ${intervalMs / 1000}s，源=${url}）`, 'info')

  // 1. 抓 N 条不同帖子
  let items = []
  try {
    const listRes = await executeScraper('threads', { url })
    items = (listRes.items || []).slice(0, count)
  } catch (e) {
    log(`✗ 抓列表失败: ${e.message}`, 'err')
    return { error: e.message }
  }
  if (items.length === 0) {
    log('✗ 抓列表为空，跳过', 'warn')
    return { skipped: true, reason: 'empty threads' }
  }
  log(`  → 抓到 ${items.length} 条帖子作为分享源`, 'info')

  // 2. notifyShare 每条帖子一次
  const results = []
  for (let i = 0; i < items.length; i++) {
    const t = items[i]
    try {
      const r = await executeAction(
        'notifyShare',
        {
          bizId: t.tid,
          shareTitle: t.title || `分享帖子 ${t.tid}`,
          shareURL: `https://bbs.hupu.com/${t.tid}.html`,
          _account: primary
        },
        ''
      )
      const ok = r.status === 200 || r.status === 'success'
      results.push({ tid: t.tid, title: t.title, ok, msg: r.data?.msg || r.reason })
      log(
        `  [${i + 1}/${items.length}] ${ok ? '✓' : '✗'} tid=${t.tid} ${(t.title || '').slice(0, 30)}`,
        ok ? 'info' : 'warn'
      )
    } catch (e) {
      results.push({ tid: t.tid, title: t.title, ok: false, msg: e.message })
      log(`  [${i + 1}/${items.length}] ✗ tid=${t.tid} 失败: ${e.message}`, 'err')
    }
    if (i < items.length - 1) await sleep(intervalMs)
  }

  const okCount = results.filter((r) => r.ok).length
  log(`完成分享: ${okCount}/${results.length} 成功`, okCount === results.length ? 'info' : 'warn')
  return { total: results.length, ok: okCount, results }
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
  },
  {
    id: 'cross-account-reply',
    name: '号与号互相回复（AI 生成）',
    description: 'A 用 AI 给 B 的主题帖回复 3 条 + 给首页 5 条帖子各回复 1 条；A↔B 互换',
    defaultSchedule: '18:00',
    run: crossAccountReplyTask
  },
  {
    id: 'daily-post-content',
    name: '每日自动发帖（AI Agent digest）',
    description:
      'AI 抓 arXiv + HN + 公司博客的论文/报告 → curator 选 1 篇 → writer 3段式撰写（核心结论/为什么值得看/对 Agent 设计的启发） → 发到指定板块',
    defaultSchedule: '12:00',
    run: dailyPostContentTask
  },
  {
    id: 'daily-share-x8',
    name: '每日分享（8 条不同帖子）',
    description:
      '抓步行街首页 N 条不同帖子 → 每条 notifyShare 1 次（间隔 30 秒）。shareCount 和 intervalMs 可在调度 Tab 调',
    defaultSchedule: '08:00',
    run: dailyShareTask
  }
]

/* ===========================================================
   调度引擎
   =========================================================== */
const taskStates = new Map() // id -> { running, lastRun, lastResult, nextRun, lastRunByDate }
const LOG_RETENTION_DAYS = 3 // 任务日志保留天数

/**
 * 把 taskStates 持久化到 scheduler-logs.json
 * 同时清理超过 LOG_RETENTION_DAYS 的旧记录（按 savedAt 字段）
 */
async function persistTaskStates() {
  const data = { savedAt: new Date().toISOString(), tasks: {} }
  for (const [id, s] of taskStates.entries()) {
    if (s.lastResult || s.lastRunByDate) {
      data.tasks[id] = {
        lastResult: s.lastResult,
        lastRunByDate: s.lastRunByDate
      }
    }
  }
  await saveSchedulerLogs(data)
}

/**
 * 启动时从 scheduler-logs.json 加载历史 lastResult / lastRunByDate
 * 同时清理超过 LOG_RETENTION_DAYS 的旧记录
 */
async function loadTaskStatesFromDisk() {
  try {
    const data = await readSchedulerLogs()
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 3600 * 1000
    let cleaned = false

    for (const [id, s] of Object.entries(data.tasks || {})) {
      const savedAt = new Date(s.lastRunByDate?.at ? new Date().setHours(0,0,0,0) : 0).getTime()
      // 用 lastRunByDate.date 判断（YYYY-MM-DD），更直观
      const taskDate = s.lastRunByDate?.date
      const taskDateTs = taskDate ? new Date(taskDate + 'T00:00:00').getTime() : 0
      if (taskDateTs < cutoff) {
        delete data.tasks[id]
        cleaned = true
        continue
      }
      // 加载到内存
      const existing = taskStates.get(id) || {}
      taskStates.set(id, {
        ...existing,
        lastResult: s.lastResult,
        lastRunByDate: s.lastRunByDate
      })
    }

    if (cleaned) await saveSchedulerLogs(data)
    const count = Object.keys(data.tasks || {}).length
    console.log(`[scheduler] 加载历史日志 ${count} 条（保留 ${LOG_RETENTION_DAYS} 天）`)
  } catch (e) {
    console.error('[scheduler] 加载历史日志失败:', e.message)
  }
}

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
 * 顺便把整段 taskSchedules[id] 透出给前端做配置面板（accountIds / postsPerAccount / fid 等）
 */
export async function getBoard() {
  const today = todayKey()
  const result = []
  const allSchedules = await readTaskSchedules()
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
      // 把整段 taskSchedules[taskId] 透出，前端按需用
      taskCfg: allSchedules[t.id] || {},
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

export async function startScheduler() {
  // 先加载历史日志（持久化的 lastResult + lastRunByDate），再开始调度
  await loadTaskStatesFromDisk()
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

  if (opts.retryOnly) {
    const lastFailed = taskStates.get(taskId)?.lastResult?.failedActions || []
    if (lastFailed.length === 0) {
      return {
        skipped: true,
        reason: '没有失败的操作可重跑',
        hint: '如需全部重跑，请勾选「强制重跑」'
      }
    }
  } else if (!opts.force && hasRunToday(taskId)) {
    const last = taskStates.get(taskId).lastRunByDate
    return {
      skipped: true,
      reason: '今日已跑过',
      ranToday: true,
      todayRun: last,
      hint: '如需重新跑，请加 ?force=1 或 ?retryOnly=1'
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

  // retryOnly 模式：从上次 lastResult.failedActions 读失败列表
  const prevFailedActions = opts.retryOnly
    ? taskStates.get(taskId)?.lastResult?.failedActions || []
    : []

  let result = null
  let error = null
  try {
    const accounts = await readAccounts()
    const ctx = {
      cookie: accounts[0]?.cookie || '', // 向后兼容
      accounts,
      log,
      sleep,
      retryOnly: !!opts.retryOnly,
      failedActions: prevFailedActions
    }
    result = await task.run(ctx)
  } catch (e) {
    error = e.message
    log(`✗ 任务异常: ${e.message}`, 'err')
  }

  // retryOnly 模式下，把重跑后仍失败的留下来；之前成功的清掉
  let mergedFailedActions = result?.failedActions || []
  if (opts.retryOnly && mergedFailedActions.length === 0) {
    log(`✓ 所有失败操作已重跑成功`, 'ok')
  }

  const finished = taskStates.get(taskId) || {}
  finished.running = false
  finished.lastResult = {
    result: result ? { ...result, failedActions: mergedFailedActions } : result,
    error,
    logs,
    logEntries,
    failedActions: mergedFailedActions
  }
  finished.lastRunByDate = {
    date: todayKey(),
    at: new Date().toLocaleTimeString('zh-CN'),
    success: !error,
    result: finished.lastResult.result,
    error,
    retryOnly: !!opts.retryOnly
  }
  taskStates.set(taskId, finished)

  // 持久化到 scheduler-logs.json（不阻塞返回；写盘失败也不影响任务结果）
  persistTaskStates().catch((e) => console.error('[scheduler] 持久化失败:', e.message))

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
