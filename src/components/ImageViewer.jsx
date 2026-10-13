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
        <Dialog.Content className="DialogContent image-viewer-content">
          {current && (
            <>
              {/* 顶角：计数 + 关闭按钮 */}
              <div className="image-viewer-header">
                <span className="image-viewer-counter">
                  {openIndex + 1} / {total}
                </span>
                <Dialog.Close asChild>
                  <button className="image-viewer-close" aria-label="关闭" type="button">
                    ✕
                  </button>
                </Dialog.Close>
              </div>

              {/* 主图：自适应视口大小 */}
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
