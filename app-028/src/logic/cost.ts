/** 成本核算与「换纸试算」 */
import { pack, type PackGroup, type PackOptions } from './packer'
import { round } from './units'
import type { CostReport, PackResult, Paper, RollSegment } from './types'

export function computeCost(
  paper: Paper,
  result: PackResult,
  opts?: Pick<PackOptions, 'marginMm' | 'safeEdgeMm'>,
): CostReport {
  const sheets = result.sheets.length
  const totalPhotoCount = result.stats.totalPhotos
  const usedArea = result.sheets.reduce((acc, s) => acc + s.usedAreaMm2, 0)

  if (paper.kind === 'roll') {
    const rollLengthMm = result.sheets[0]?.roll?.supplyLengthMm ?? paper.hMm
    const usedLengthMm = result.sheets.reduce(
      (acc, s) => acc + (s.physicalHeightMm ?? rollLengthMm),
      0,
    )
    const exactTotalBySupply = result.sheets.reduce(
      (acc, s) =>
        acc +
        ((s.physicalHeightMm ?? (s.roll?.supplyLengthMm ?? rollLengthMm)) /
          (s.roll?.supplyLengthMm ?? rollLengthMm)) *
          (s.roll?.supplyPriceCents ?? paper.priceCents),
      0,
    )
    const effectivePriceCentsPerMeter =
      usedLengthMm > 0 ? exactTotalBySupply / (usedLengthMm / 1000) : 0
    const totalCents = Math.round(exactTotalBySupply)

    // 分摊到每个切断段，保证逐卷金额相加严格等于本单总额，避免四舍五入差 1 分。
    const exactSegments = result.sheets.map((sheet, i) => ({
      supplyIndex: sheet.roll?.supplyIndex ?? i,
      usedLengthMm: sheet.physicalHeightMm ?? rollLengthMm,
      supplyLengthMm: sheet.roll?.supplyLengthMm ?? rollLengthMm,
      supplyPriceCents: sheet.roll?.supplyPriceCents ?? paper.priceCents,
      supplyLeftover: sheet.roll?.supplyLeftover ?? false,
      fullRollConsumed:
        (sheet.physicalHeightMm ?? rollLengthMm) >=
        (sheet.roll?.supplyLengthMm ?? rollLengthMm) - 1e-6,
    }))
    const exactCents = exactSegments.map(
      (x) => (x.usedLengthMm / x.supplyLengthMm) * x.supplyPriceCents,
    )
    const floored = exactCents.map((x) => Math.floor(x))
    let remainder = totalCents - floored.reduce((a, b) => a + b, 0)
    const fractionOrder = exactCents
      .map((x, i) => ({ i, fraction: x - Math.floor(x) }))
      .sort((a, b) => b.fraction - a.fraction)
    for (const item of fractionOrder) {
      if (remainder <= 0) break
      floored[item.i] += 1
      remainder -= 1
    }
    const rollSegments: RollSegment[] = result.sheets.map((_, i) => {
      const usedLengthMm = round(exactSegments[i].usedLengthMm, 4)
      return {
        rollIndex: i,
        supplyIndex: exactSegments[i].supplyIndex,
        usedLengthMm,
        supplyLengthMm: exactSegments[i].supplyLengthMm,
        supplyPriceCents: exactSegments[i].supplyPriceCents,
        supplyLeftover: exactSegments[i].supplyLeftover,
        leftoverLengthMm: round(Math.max(0, exactSegments[i].supplyLengthMm - usedLengthMm), 4),
        crossCutAtMm: usedLengthMm,
        fullRollConsumed: exactSegments[i].fullRollConsumed,
        costCents: floored[i],
      }
    })

    const inset = (opts?.marginMm ?? paper.marginMm) + (opts?.safeEdgeMm ?? 0)
    // 不排样基准：每张照片单独从卷上送一段，每段只保留一次卷首纸边/安全边。
    const naiveLengthMm = result.sheets.reduce(
      (acc, s) =>
        acc +
        s.placements.reduce((sum, p) => sum + p.h + inset, 0),
      0,
    )
    const baselineRollLengthMm = paper.parentRoll?.hMm ?? rollLengthMm
    const baselineRollPriceCents = paper.parentRoll?.priceCents ?? paper.priceCents
    const naiveTotalCents = Math.round(
      (naiveLengthMm / baselineRollLengthMm) * baselineRollPriceCents,
    )
    const chargedArea = usedLengthMm * paper.wMm
    const naiveArea = naiveLengthMm * paper.wMm
    const usedMeters = round(usedLengthMm / 1000, 4)
    const finalLeftover = rollSegments[rollSegments.length - 1]?.leftoverLengthMm ?? 0
    const leftoverMeters = round(finalLeftover / 1000, 4)
    return {
      paperName: paper.name,
      sheets,
      totalCents,
      perPhotoCents: totalPhotoCount > 0 ? round(totalCents / totalPhotoCount, 2) : 0,
      totalPhotoCount,
      wasteRate: chargedArea > 0 ? 1 - usedArea / chargedArea : 0,
      naiveWasteRate: naiveArea > 0 ? 1 - usedArea / naiveArea : 0,
      naiveTotalCents,
      savedCents: naiveTotalCents - totalCents,
      priceCentsPerMeter: round(effectivePriceCentsPerMeter, 2),
      usedMeters,
      leftoverMeters,
      rollSegments,
    }
  }

  const totalCents = sheets * paper.priceCents
  const perPhotoCents = totalPhotoCount > 0 ? totalCents / totalPhotoCount : 0
  const totalSheetArea = sheets * paper.wMm * paper.hMm
  const wasteRate = totalSheetArea > 0 ? 1 - usedArea / totalSheetArea : 0
  // 不排样：每张照片单独用一整张相纸
  const naiveTotalCents = totalPhotoCount * paper.priceCents
  const naiveArea = totalPhotoCount * paper.wMm * paper.hMm
  const naiveWasteRate = naiveArea > 0 ? 1 - usedArea / naiveArea : 0
  return {
    paperName: paper.name,
    sheets,
    totalCents,
    perPhotoCents: round(perPhotoCents, 2),
    totalPhotoCount,
    wasteRate,
    naiveWasteRate,
    naiveTotalCents,
    savedCents: naiveTotalCents - totalCents,
  }
}

export function computeCostForSheets(
  paper: Paper,
  sheets: PackResult['sheets'],
  opts?: Pick<PackOptions, 'marginMm' | 'safeEdgeMm'>,
): CostReport {
  const result: PackResult = {
    sheets,
    stats: {
      totalPhotos: sheets.reduce((acc, s) => acc + s.placements.length, 0),
      sheets: sheets.length,
      avgUtilization: 0,
      elapsedMs: 0,
      keepTogetherBroken: [],
      usedLengthMm: sheets.reduce((acc, s) => acc + (s.physicalHeightMm ?? paper.hMm), 0),
      leftoverLengthMm: sheets[sheets.length - 1]?.roll?.leftoverLengthMm,
    },
  }
  return computeCost(paper, result, opts)
}

export interface PaperCompare {
  paper: Paper
  sheets: number
  avgUtilization: number
  totalCents: number
  perPhotoCents: number
  usedMeters?: number
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
    if (p.kind === 'roll') continue
    const r = pack(groups, { ...opts, paperW: p.wMm, paperH: p.hMm, marginMm: p.marginMm })
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
    const cost = computeCost(p, r.result, { marginMm: p.marginMm, safeEdgeMm: opts.safeEdgeMm })
    out.push({
      paper: p,
      sheets: cost.sheets,
      avgUtilization: r.result.stats.avgUtilization,
      totalCents: cost.totalCents,
      perPhotoCents: cost.perPhotoCents,
      usedMeters: cost.usedMeters,
    })
  }
  return out
    .filter((c) => !c.error)
    .sort((a, b) => a.totalCents - b.totalCents || b.avgUtilization - a.avgUtilization)
    .slice(0, limit)
}
