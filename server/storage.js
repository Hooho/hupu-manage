// 数据持久化（拆出来供 scheduler / scraper 等模块复用）
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.join(__dirname, 'data')

export const FILES = {
  CONFIG: path.join(DATA_DIR, 'config.json'),
  USERS: path.join(DATA_DIR, 'users.json'),
  OPERATIONS: path.join(DATA_DIR, 'operations.json'),
  PROGRESS: path.join(DATA_DIR, 'progress.json'),
  STATS: path.join(DATA_DIR, 'stats.json'),
  SCHEDULER_LOGS: path.join(DATA_DIR, 'scheduler-logs.json')
}

await fs.mkdir(DATA_DIR, { recursive: true })

async function readJson(file, fallback) {
  try {
    const data = await fs.readFile(file, 'utf-8')
    return JSON.parse(data)
  } catch {
    return fallback
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2))
}

export const readConfig = () => readJson(FILES.CONFIG, { cookie: '', euids: [] })
export const saveConfig = (c) => writeJson(FILES.CONFIG, c)
export const readUsers = () => readJson(FILES.USERS, [])
export const saveUsers = (u) => writeJson(FILES.USERS, u)
export const readProgress = () => readJson(FILES.PROGRESS, {})
export const saveProgress = (p) => writeJson(FILES.PROGRESS, p)
export const readStats = () => readJson(FILES.STATS, {})
export const saveStats = (s) => writeJson(FILES.STATS, s)
export const readSchedulerLogs = () => readJson(FILES.SCHEDULER_LOGS, { tasks: {}, savedAt: null })
export const saveSchedulerLogs = (d) => writeJson(FILES.SCHEDULER_LOGS, d)

export async function readOperations() {
  return readJson(FILES.OPERATIONS, [])
}

export async function saveOperation(operation) {
  const list = await readOperations()
  list.push({ ...operation, timestamp: Date.now() })
  await writeJson(FILES.OPERATIONS, list)
}

/* ===========================================================
   多账号管理
   =========================================================== */

/**
 * 读账号列表。
 * 自动从旧 config 迁移：如果 config 顶层有 cookie 但没 accounts，把 cookie 包成默认账号。
 */
export async function readAccounts() {
  const c = await readConfig()
  if (Array.isArray(c.accounts) && c.accounts.length > 0) return c.accounts
  // 迁移旧 config
  if (c.cookie) {
    const account = {
      id: 'A',
      name: '默认账号',
      cookie: c.cookie,
      uid: '',
      primary: true,
      addedAt: new Date().toISOString(),
      migrated: true
    }
    c.accounts = [account]
    await saveConfig(c)
    return [account]
  }
  return []
}

function nextAccountId(accounts) {
  const used = new Set(accounts.map((a) => a.id))
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i)
    if (!used.has(id)) return id
  }
  return `id_${accounts.length + 1}`
}

export async function addAccount({ cookie, name, uid, euid, primary }) {
  if (!cookie) throw new Error('缺少 cookie')
  const c = await readConfig()
  if (!Array.isArray(c.accounts)) c.accounts = []
  const id = nextAccountId(c.accounts)
  // 如果这是第一个账号，或显式要求 primary，自动设为主账号
  const isPrimary =
    primary === true || c.accounts.length === 0
  if (isPrimary) {
    c.accounts.forEach((a) => (a.primary = false))
  }
  const account = {
    id,
    name: name || `账号 ${id}`,
    cookie,
    uid: uid || '',
    euid: euid || '',
    primary: isPrimary,
    addedAt: new Date().toISOString()
  }
  c.accounts.push(account)
  await saveConfig(c)
  return account
}

/**
 * 把指定账号设为主账号（其余自动取消主账号）
 */
export async function setPrimaryAccount(id) {
  const c = await readConfig()
  if (!Array.isArray(c.accounts)) throw new Error('账号列表为空')
  const i = c.accounts.findIndex((a) => a.id === id)
  if (i < 0) throw new Error('账号不存在')
  c.accounts.forEach((a) => (a.primary = a.id === id))
  await saveConfig(c)
  return c.accounts.find((a) => a.id === id)
}

/* ===========================================================
   任务调度配置（持久化）
   =========================================================== */

export async function readTaskSchedules() {
  const c = await readConfig()
  return c.taskSchedules || {}
}

export async function saveTaskSchedules(s) {
  const c = await readConfig()
  c.taskSchedules = s
  await saveConfig(c)
}

export async function updateTaskSchedule(id, patch) {
  const s = await readTaskSchedules()
  s[id] = { ...(s[id] || {}), ...patch }
  await saveTaskSchedules(s)
  return s[id]
}

export async function removeAccount(id) {
  const c = await readConfig()
  if (!Array.isArray(c.accounts)) return []
  c.accounts = c.accounts.filter((a) => a.id !== id)
  await saveConfig(c)
  return c.accounts
}

export async function updateAccount(id, patch) {
  const c = await readConfig()
  if (!Array.isArray(c.accounts)) return null
  const i = c.accounts.findIndex((a) => a.id === id)
  if (i < 0) return null
  c.accounts[i] = { ...c.accounts[i], ...patch }
  await saveConfig(c)
  return c.accounts[i]
}

export async function getAccount(id) {
  const accounts = await readAccounts()
  return accounts.find((a) => a.id === id) || null
}

/**
 * 拿主账号（标记为 primary 的账号）。如果没标记，拿第一个。
 */
export async function getPrimaryAccount() {
  const accounts = await readAccounts()
  if (accounts.length === 0) return null
  return accounts.find((a) => a.primary) || accounts[0]
}

/**
 * 拿主账号的 cookie 字符串（兼容旧的 config.cookie 字段）
 */
export async function getPrimaryCookie() {
  const primary = await getPrimaryAccount()
  if (primary && primary.cookie) return primary.cookie
  // 兼容旧 config.cookie 字段
  const c = await readConfig()
  return c.cookie || ''
}
