// 图片放大预览弹窗
// - Radix Dialog 实现，背景遮罩 + ESC 关闭
// - 多图支持：左右切换按钮、键盘 ← → 切换、底部缩略图条
// - 顶角显示 "N/M" 计数
import { useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

export default function ImageViewer({ images, openIndex, onClose }) {
  const open = openIndex !== null && openIndex !== undefined && images.length > 0
  const total = images.length
  const current = open ? images[openIndex] : null
  const hasPrev = open && openIndex > 0
  const hasNext = open && openIndex < total - 1

  // 键盘 ← → 切换图片（弹窗打开时）
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' && hasPrev) onClose(openIndex - 1)
      else if (e.key === 'ArrowRight' && hasNext) onClose(openIndex + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openIndex, hasPrev, hasNext, onClose])

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => { if (!v) onClose(null) }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="DialogOverlay image-viewer-overlay" />
        <Dialog.Content
          className="DialogContent image-viewer-content"
          onClick={(e) => {
            // 点到 content 自身的空白处（图/按钮之间的 gap）就关闭。
            // 点到 image/buttons 不会触发（e.target 是子元素，不是 currentTarget）。
            // Radix 的 overlay 关闭只覆盖 content 框外的点击；content 内部
            // 空白处需要这个手动关闭逻辑。
            if (e.target === e.currentTarget) onClose(null)
          }}
        >
          {current && (
            <>
              {/* 顶角：计数 + 关闭提示 + 大号 ✕ 按钮 */}
              <div className="image-viewer-header">
                <span className="image-viewer-counter">
                  {openIndex + 1} / {total}
                </span>
                <span className="image-viewer-hint">点击空白处 / 按 ESC 关闭</span>
                <Dialog.Close asChild>
                  <button className="image-viewer-close" aria-label="关闭" type="button">
                    ✕
                  </button>
                </Dialog.Close>
              </div>

              {/* 主图：用 pic.url 列表原图（Hupu CDN 该尺寸就能加载，
                  不要再重写尺寸——Hupu 不做 resize，任意写 _w_X_h_Y_ 会 404）。
                  如果将来要做大图，用后端代理或 fetch 拿真原图。 */}
              <img
                src={current.url}
                alt=""
                className="image-viewer-img"
                referrerPolicy="no-referrer"
              />

              {/* 上一张 / 下一张按钮 */}
              {hasPrev && (
                <button
                  type="button"
                  className="image-viewer-nav image-viewer-prev"
                  onClick={() => onClose(openIndex - 1)}
                  aria-label="上一张"
                >
                  ‹
                </button>
              )}
              {hasNext && (
                <button
                  type="button"
                  className="image-viewer-nav image-viewer-next"
                  onClick={() => onClose(openIndex + 1)}
                  aria-label="下一张"
                >
                  ›
                </button>
              )}

              {/* 底部缩略图条（多图时显示） */}
              {total > 1 && (
                <div className="image-viewer-thumbs">
                  {images.map((img, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`image-viewer-thumb${i === openIndex ? ' active' : ''}`}
                      onClick={() => onClose(i)}
                      aria-label={`第 ${i + 1} 张`}
                    >
                      <img
                        src={img.url}
                        alt=""
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
