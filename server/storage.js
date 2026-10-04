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
  STATS: path.join(DATA_DIR, 'stats.json')
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

export async function readOperations() {
  return readJson(FILES.OPERATIONS, [])
}

export async function saveOperation(operation) {
  const list = await readOperations()
  list.push({ ...operation, timestamp: Date.now() })
  await writeJson(FILES.OPERATIONS, list)
}
