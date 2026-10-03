/** 成本核算与「换纸试算」 */
import { pack, type PackGroup, type PackOptions } from './packer'
import { round } from './units'
import type { CostReport, PackResult, Paper, RollCostSegment, Sheet } from './types'

export function paperPriceUnit(paper: Paper): 'sheet' | 'meter' {
  if (paper.kind === 'roll') return paper.priceUnit === 'sheet' ? 'sheet' : 'meter'
  return 'sheet'
}

/** 卷筒纸按实际切段长度计价；单张纸仍按张计价 */
export function rollLengthCents(paper: Paper, lengthMm: number): number {
  return (paper.priceCents * lengthMm) / 1000
}

function rollSegmentsFromSheets(paper: Paper, sheets: Sheet[]): RollCostSegment[] {
  return sheets
    .filter((s) => s.roll)
    .map((s) => {
      const roll = s.roll!
      const totalCents = round(rollLengthCents(paper, roll.usedLengthMm), 4)
      const photoCount = s.placements.length
      return {
        rollNumber: roll.rollNumber,
        usedLengthMm: roll.usedLengthMm,
        leftoverLengthMm: roll.leftoverLengthMm,
        cutAtMm: roll.cutAtMm,
        startOffsetMm: roll.startOffsetMm,
        endOffsetMm: roll.endOffsetMm,
        totalCents,
        perPhotoCents: photoCount > 0 ? round(totalCents / photoCount, 4) : 0,
        photoCount,
        fullyUsed: roll.fullyUsed,
      }
    })
}

export function computeCost(
  paper: Paper,
  result: PackResult,
  sheetsOverride?: Sheet[],
  safeEdgeMm = 0,
): CostReport {
  const sheets = sheetsOverride ?? result.sheets
  const totalPhotoCount = result.stats.totalPhotos
  const usedArea = sheets.reduce((acc, s) => acc + s.usedAreaMm2, 0)
  const billedArea = sheets.reduce((acc, s) => acc + s.sheetAreaMm2, 0)
  const wasteRate = billedArea > 0 ? 1 - usedArea / billedArea : 0
  const isRoll = paper.kind === 'roll' && paperPriceUnit(paper) === 'meter'
  const perCopyEndMm = paper.marginMm + safeEdgeMm
  const rollSegments = isRoll ? rollSegmentsFromSheets(paper, sheets) : undefined
  const sheetCount = sheets.length
  const totalCents = isRoll
    ? round(
        rollSegments!.reduce((acc, s) => acc + s.totalCents, 0),
        4,
      )
    : sheetCount * paper.priceCents
  const perPhotoCents = totalPhotoCount > 0 ? totalCents / totalPhotoCount : 0
  // 不排样：每张照片按其占用的独立纸段/整张相纸核算
  const naiveBilledArea = isRoll
    ? sheets.reduce(
        (acc, s) =>
          acc +
          s.placements.reduce(
            (sum, p) =>
              sum +
              paper.wMm *
                (p.h + 2 * perCopyEndMm /* 简化为每段上下纸边，横向浪费由宽度差异体现 */),
            0,
          ),
        0,
      )
    : totalPhotoCount * paper.wMm * paper.hMm
  // 卷筒的保守逐张成本：每幅图至少按纸宽成段，另加两端纸边
  const naiveTotalCents = isRoll
    ? round(
        sheets.reduce(
          (acc, s) =>
            acc +
            s.placements.reduce(
              (sum, p) => sum + rollLengthCents(paper, p.h + 2 * perCopyEndMm),
              0,
            ),
          0,
        ),
        4,
      )
    : totalPhotoCount * paper.priceCents
  const naiveWasteRate = naiveBilledArea > 0 ? 1 - usedArea / naiveBilledArea : 0
  return {
    paperName: paper.name,
    sheets: sheetCount,
    totalCents: round(totalCents, 4),
    perPhotoCents: round(perPhotoCents, 4),
    totalPhotoCount,
    wasteRate,
    naiveWasteRate,
    naiveTotalCents,
    savedCents: round(naiveTotalCents - totalCents, 4),
    totalUsedMeters: isRoll
      ? round(rollSegments!.reduce((acc, s) => acc + s.usedLengthMm, 0) / 1000, 4)
      : undefined,
    priceCentsPerMeter: isRoll ? paper.priceCents : undefined,
    rollSegments,
  }
}

export interface PaperCompare {
  paper: Paper
  sheets: number
  avgUtilization: number
  totalCents: number
  perPhotoCents: number
  error?: string
}

/** 利用率偏低时自动试算 2~3 种其它相纸规格做对比 */
export function comparePapers(
  groups: PackGroup[],
  opts: Omit<PackOptions, 'paperW' | 'paperH' | 'marginMm'>,
  papers: Paper[],
  currentPaperId: string,
  limit = 3,
): PaperCompare[] {
  const out: PaperCompare[] = []
  for (const p of papers) {
    if (p.id === currentPaperId) continue
    const r = pack(groups, {
      ...opts,
      paperW: p.wMm,
      paperH: p.hMm,
      marginMm: p.marginMm,
      variableLength: p.kind === 'roll' && paperPriceUnit(p) === 'meter',
    })
    if (r.error) {
      out.push({
        paper: p,
        sheets: 0,
        avgUtilization: 0,
        totalCents: 0,
        perPhotoCents: 0,
        error: r.error,
      })
      continue
    }
    const cost = computeCost(p, r.result, undefined, opts.safeEdgeMm)
    out.push({
      paper: p,
      sheets: cost.sheets,
      avgUtilization: r.result.stats.avgUtilization,
      totalCents: cost.totalCents,
      perPhotoCents: cost.perPhotoCents,
    })
  }
  return out
    .filter((c) => !c.error)
    .sort((a, b) => a.totalCents - b.totalCents || b.avgUtilization - a.avgUtilization)
    .slice(0, limit)
}
