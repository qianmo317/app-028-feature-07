/** 导出 CSV（带 BOM，Excel 直接打开不乱码） */
import { round } from './units'
import type { Paper, RollSegment, Sheet, Task } from './types'

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
  return new Blob(['\uFEFF' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
}

export function cutListRows(
  task: Task,
  paper: Paper,
  sheets: Sheet[],
  sizeLabelOf: (seq: number) => string,
  rollSegments?: RollSegment[],
): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    ['相纸', `${paper.name} ${paper.wMm}x${paper.hMm}mm`],
    paper.kind === 'roll'
      ? ['整卷长度 m', round(paper.hMm / 1000, 3)]
      : [],
    ['隙距 mm', task.gapMm],
    ['刀宽补偿 mm', task.kerfMm],
    ['安全边 mm', task.safeEdgeMm],
    ['相纸张数/切段数', sheets.length],
  ]
  if (paper.kind === 'roll') {
    rows.push(
      [],
      ['卷/段序号', '供给来源', '供给卷长 m', '用掉长度 m', '横切断点 mm', '用后余料 m', '是否整卷用尽', '本段金额（元）'],
    )
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i]
      const seg = rollSegments?.[i] ?? s.roll
      rows.push([
        s.index + 1,
        seg?.supplyLeftover ? '余料卷' : '新整卷',
        round((seg?.supplyLengthMm ?? paper.hMm) / 1000, 3),
        round((s.physicalHeightMm ?? paper.hMm) / 1000, 3),
        round(s.physicalHeightMm ?? paper.hMm, 1),
        round((seg?.leftoverLengthMm ?? 0) / 1000, 3),
        seg?.fullRollConsumed ? '是' : '否',
        ((seg?.costCents ?? Math.round(((s.physicalHeightMm ?? paper.hMm) / paper.hMm) * paper.priceCents)) / 100).toFixed(2),
      ])
    }
    rows.push([])
  }
  rows.push(
    ['相纸序号', '刀序', '方向', '坐标 mm', '起点 mm', '终点 mm', '长度 mm', '是否共边合并'],
  )
  for (const s of sheets) {
    s.cutSteps.forEach((c, i) => {
      rows.push([
        s.index + 1,
        i + 1,
        c.axis === 'v' ? '竖切' : '横切',
        Math.round(c.at * 100) / 100,
        Math.round(c.from * 100) / 100,
        Math.round(c.to * 100) / 100,
        Math.round((c.to - c.from) * 100) / 100,
        c.merged ? '是' : '否',
      ])
    })
    rows.push([])
  }
  rows.push(['照片编号', '所在相纸', '尺寸', 'x mm', 'y mm', '宽 mm', '高 mm', '旋转'])
  for (const s of sheets) {
    for (const p of s.placements) {
      rows.push([
        p.seq,
        s.index + 1,
        sizeLabelOf(p.seq),
        Math.round(p.x * 100) / 100,
        Math.round(p.y * 100) / 100,
        Math.round(p.w * 100) / 100,
        Math.round(p.h * 100) / 100,
        p.rotated ? '90°' : '无',
      ])
    }
  }
  return rows
}
