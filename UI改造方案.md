# UI 改造方案 · 精致化方向

> 范围：HomePage / ReportResultsPage / ConfigPage 三页一起
> 引入：Radix UI Headless 组件（仅无样式、可访问性增强）
> 保留：极简基调、纯文字为主的信息密度

---

## 一、设计 Token 草案

### 颜色
| 用途 | Before | After |
|---|---|---|
| 页面底色 | `#fbfbfa` | `#fafaf9`（更柔和） |
| 卡片/表面 | `#ffffff` | `#ffffff`（保留） |
| 文字主色 | `#1f1f1e` | `#1c1c1b` |
| 文字副色 | `#6b6b68` | `#6b6b68` |
| 文字弱化 | `#9a9a96` | `#9a9a96` |
| 分隔线 | `rgba(0,0,0,0.09)` | `rgba(0,0,0,0.06)`（更轻） |
| 分隔线强 | `rgba(0,0,0,0.18)` | `rgba(0,0,0,0.12)` |
| 主按钮 | ❌ 无 | `#1c1c1b`（黑底白字） |
| 危险 | `#b42318` | `#b42318`（保留） |
| 成功 | `#22683f` | `#1f7a4d` |
| 成功背景 | ❌ 无 | `#ecfdf3` |
| 焦点环 | ❌ outline 1px | `outline 2px var(--focus)` |

### 尺寸 / 圆角 / 阴影
| 类别 | Before | After |
|---|---|---|
| 圆角 (按钮/输入) | 6px | 6px（保留） |
| 圆角 (卡片) | 6px | 8px |
| 圆角 (徽标) | ❌ | 999px（胶囊） |
| 阴影 | ❌ 无 | `--sh-sm/md/lg` 三档 |
| 列表行 padding | 14px 0 | 16px（含卡片化） |
| 列表行间距 | 1px 线 | 8px 间距 |
| 标题字号 | 14–15px | 18px（page title） |

### 动效
- 全局 transition: `160ms cubic-bezier(0.4, 0, 0.2, 1)`
- 按钮 active 状态：`scale(0.98)`
- hover：背景/边框平滑过渡
- 加载：skeleton shimmer 动画

---

## 二、组件级改进

### 导航栏
| 项 | Before | After |
|---|---|---|
| Brand | 无 | 篮球 logo + "虎扑管理" |
| Tab 样式 | 纯文字 + 下划线 | 胶囊背景 + 圆角 + 白底高亮 |
| Tab 间距 | 20px | 紧凑分组 |
| 右侧 | 空 | 版本号 + 状态 |

### 按钮
| 项 | Before | After |
|---|---|---|
| 主按钮样式 | ❌ 无 | `.btn.primary` 黑底白字 |
| Hover 反馈 | 仅浅灰底 | 边框加深 + 背景变化 |
| Active 反馈 | ❌ | `scale(0.98)` |
| Focus 环 | outline 1px text-2 | outline 2px + offset |
| Disabled | 浅灰 | 透明 + 文字弱化 |
| 尺寸 | 单一 | `.sm` 26px / 默认 32px |
| Icon-only | ❌ | `.btn.icon` 32×32 |

### 表单输入
| 项 | Before | After |
|---|---|---|
| Input 边框 | 1px line-strong | 1px line-strong |
| Focus | outline 1px text-2 | outline 2px focus + 边框变色 |
| Label 样式 | 行内小字 | `.field-label` 块级 13px 500 |
| Hint | 灰色小字 | `.field-hint` 12px 弱化 |
| 错误态 | ❌ | danger 边框 + 红色 hint |

### 自定义 Checkbox
- 替换原生 checkbox：用 Radix `@radix-ui/react-checkbox`
- 自定义视觉：16×16 + 圆角 + checked 黑底白勾
- 支持 indeterminate 状态

### 自定义 Select（账号切换）
- 替换原生 `<select>`：用 Radix `@radix-ui/react-select` 或 `DropdownMenu`
- 支持头像/图标 + 自定义渲染
- 键盘可访问（Arrow Up/Down/Enter）

### 列表卡片（回帖/记录）
- 从纯下划线分隔升级为**卡片化**
- 每条卡片：checkbox + 内容 + meta + 操作按钮
- Hover：边框加深 + 轻阴影
- 状态：
  - 已举报：左侧 3px 绿色指示条 + 内容划掉 + 弱化
  - 上次失败：meta 显示红色 badge
- 操作按钮：默认 `danger` 配色（红字红边）

### 进度条
- 替代纯文字"举报中 3/5"
- 4px 高的圆角条 + 黑色填充 + 文字标签

### 状态徽标（Badge）
- 胶囊样式（圆角 999）
- 三种状态：default / success / danger
- 5×5 圆点 + 文字

### 统计卡片（记录页）
- 替代两行纯文本
- 数字大字号（18px 500）+ 文字小标签
- 数字颜色编码：成功绿、失败红

### 设置页分组
- 用卡片化分区：请求、监控账号
- 监控账号列表改为：左侧头像占位 + 用户名 + meta + 操作按钮组

### 翻页器
- 居中按钮组（上一页 / 下一页）
- 禁用态明显

---

## 三、Headless 库选型（Radix UI）

只装会用到的子包，按需引入（每个子包 ~3-5KB gzip）：

```bash
npm i @radix-ui/react-dropdown-menu   # 账号切换下拉
npm i @radix-ui/react-checkbox        # 全选/单选
npm i @radix-ui/react-dialog          # 移除账号二次确认
npm i @radix-ui/react-tooltip         # 字段说明 hover
npm i @radix-ui/react-popover         # 添加账号 popover
npm i @radix-ui/react-progress        # 批量举报进度条
npm i @radix-ui/react-visually-hidden # a11y
```

**不引入**：
- ❌ 任何 styled component / tailwind / emotion
- ❌ 任何图标库（用内联 SVG 即可）
- ❌ shadcn/ui 全套（按需拷贝需要的 Radix 包装即可）

---

## 四、文件改动清单

```
src/
├── index.css              # 重写为 token-based 设计系统
├── App.jsx                # 加 logo + Radix 化的导航
├── components/            # 新增
│   ├── Topbar.jsx
│   ├── Button.jsx
│   ├── Card.jsx
│   ├── Checkbox.jsx       # Radix Checkbox 封装
│   ├── Select.jsx         # Radix DropdownMenu 封装
│   ├── Dialog.jsx         # Radix Dialog 封装
│   ├── Badge.jsx
│   ├── ProgressBar.jsx    # Radix Progress 封装
│   ├── EmptyState.jsx
│   └── Skeleton.jsx
├── pages/
│   ├── HomePage.jsx       # 卡片化回帖 + 进度条
│   ├── ReportResultsPage.jsx  # 统计卡片 + 卡片化记录
│   └── ConfigPage.jsx     # 分组卡片 + Radix Dialog 确认
└── hooks/
    └── useToast.js        # 可选：封装 react-hot-toast
```

---

## 五、保留不变

- 后端 API 路径（`/api/...`）不变
- localStorage key（`viewedItems` / `lastActiveEuid`）不变
- 路由结构不变
- 现有依赖（axios / cheerio / express / react-hot-toast）不变
- 极简质感不变（不加花哨色、不加动画花活）

---

## 六、可选二期

- 暗色模式（设计 token 已经预留 `--bg-2` 等）
- 字段拖拽排序（监控账号）
- 快捷键（j/k 上下条、x 选中、r 举报）
- 移动端适配（当前固定 880px）

---

## 七、本次预览

- `preview-after.html` —— 精致化后的三页静态预览（含 mock 数据 + 交互态）
- `preview-compare.html` —— before / after 并排对比
- 预览服务：`http://localhost:4174/preview-after.html`
