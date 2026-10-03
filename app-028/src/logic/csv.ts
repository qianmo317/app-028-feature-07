/** 导出 CSV（带 BOM，Excel 直接打开不乱码） */
import { paperPriceUnit, rollLengthCents } from './cost'
import type { Paper, Sheet, Task } from './types'

export function toCsv(rows: Array<Array<string | number>>): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? '')
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    )
    .join('\r\n')
}

export function csvBlob(rows: Array<Array<string | number>>): Blob {
  return new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
}

export function sheetPaperOf(paper: Paper, sheet: Sheet): Paper {
  if (paper.kind === 'roll' && sheet.roll) {
    return { ...paper, hMm: sheet.roll.usedLengthMm }
  }
  return paper
}

const n2 = (v: number) => Math.round(v * 100) / 100

export function cutListRows(
  task: Task,
  paper: Paper,
  sheets: Sheet[],
  sizeLabelOf: (seq: number) => string,
): Array<Array<string | number>> {
  const isRollMeter = paper.kind === 'roll' && paperPriceUnit(paper) === 'meter'
  const rows: Array<Array<string | number>> = [
    ['相纸', `${paper.name} ${paper.wMm}x${paper.hMm}mm${isRollMeter ? '（卷筒，按米计价）' : ''}`],
    ['隙距 mm', task.gapMm],
    ['刀宽补偿 mm', task.kerfMm],
    ['安全边 mm', task.safeEdgeMm],
    [isRollMeter ? '切段数' : '相纸张数', sheets.length],
    [],
  ]
  if (isRollMeter) {
    rows.push(
      ['卷/段序号', '整卷长度 mm', '本卷使用 mm', '切断位置 mm', '本次起点 mm', '本次断点 mm', '余料 mm', '金额 元'],
      ...sheets.map((s) => {
        const r = s.roll!
        return [
          r.rollNumber,
          n2(r.stockLengthMm),
          n2(r.usedLengthMm),
          n2(r.cutAtMm),
          n2(r.startOffsetMm),
          n2(r.endOffsetMm),
          n2(r.leftoverLengthMm),
          (rollLengthCents(paper, r.usedLengthMm) / 100).toFixed(4),
        ]
      }),
      [],
    )
  }
  rows.push(['相纸序号', '刀序', '方向', '坐标 mm', '起点 mm', '终点 mm', '长度 mm', '是否共边合并'])
  for (const s of sheets) {
    s.cutSteps.forEach((c, i) => {
      rows.push([
        s.index + 1,
        i + 1,
        c.axis === 'v' ? '竖切' : '横切',
        n2(c.at),
        n2(c.from),
        n2(c.to),
        n2(c.to - c.from),
        c.merged ? '是' : '否',
      ])
    })
    if (s.roll) {
      rows.push([
        s.index + 1,
        s.cutSteps.length + 1,
        '卷筒横断',
        n2(s.roll.cutAtMm),
        0,
        n2(paper.wMm),
        n2(paper.wMm),
        s.roll.fullyUsed ? '卷尾，余料 0' : '切下后保留余料',
      ])
    }
    rows.push([])
  }
  rows.push(['照片编号', '所在相纸/卷段', '尺寸', 'x mm', 'y mm', '宽 mm', '高 mm', '旋转'])
  for (const s of sheets) {
    for (const p of s.placements) {
      rows.push([
        p.seq,
        s.index + 1,
        sizeLabelOf(p.seq),
        n2(p.x),
        n2(p.y),
        n2(p.w),
        n2(p.h),
        p.rotated ? '90°' : '无',
      ])
    }
  }
  return rows
}
