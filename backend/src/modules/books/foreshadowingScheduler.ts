import type { RuntimeForeshadowing } from "../../schemas/runtimeStateSchemas.js";

export interface ScheduledForeshadowing extends RuntimeForeshadowing {
  scheduleStatus: "on_track" | "due" | "overdue";
  missedCount: number;
  targetChapterRange: { start: number; end: number } | null;
  forceRecovery: boolean;
}

/**
 * 用结构化目标章节区间调度伏笔。旧数据只含“第 N 卷/第 N 章”的自然语言计划时，
 * 退化为从文本抽取章节号；抽不到则不误触发强制回收。
 */
export function scheduleForeshadowing(
  items: RuntimeForeshadowing[],
  chapterNo: number
): ScheduledForeshadowing[] {
  return items.map((item) => {
    const targetChapterRange = item.targetChapterRange ?? extractTargetChapterRange(item.resolution);
    const missedCount = item.missedCount ?? 0;
    const active = !["resolved", "archived"].includes(item.status);
    const scheduleStatus = !active || !targetChapterRange
      ? "on_track" as const
      : chapterNo > targetChapterRange.end
        ? "overdue" as const
        : chapterNo >= targetChapterRange.start
          ? "due" as const
          : "on_track" as const;
    return {
      ...item,
      scheduleStatus,
      missedCount,
      targetChapterRange,
      forceRecovery: scheduleStatus === "overdue" && missedCount >= 2
    };
  });
}

/**
 * 在本章未推进/回收一条到期伏笔后，增加漏处理次数。两次漏处理后下一章必须注入强制回收约束。
 * 不会修改已 resolved/archived 的伏笔，也不会把 planned 的远期伏笔计为 missed。
 */
export function reconcileForeshadowingSchedule(
  items: RuntimeForeshadowing[],
  chapterNo: number,
  touchedIds: Set<string>
): RuntimeForeshadowing[] {
  return scheduleForeshadowing(items, chapterNo).map((item) => {
    const wasTouched = touchedIds.has(item.id);
    const canMiss = item.scheduleStatus === "due" || item.scheduleStatus === "overdue";
    return {
      ...item,
      scheduleStatus: wasTouched ? "on_track" : item.scheduleStatus,
      missedCount: wasTouched ? 0 : (canMiss ? item.missedCount + 1 : item.missedCount),
      targetChapterRange: item.targetChapterRange,
      lastAdvancedChapter: item.lastAdvancedChapter
    };
  }).map(({ forceRecovery: _forceRecovery, ...item }) => item);
}

/** 解析显式“第 N 章”与“第 N-M 章”。只把可以被稳定解析的计划用于自动强制，避免误判。 */
export function extractTargetChapterRange(text: string): { start: number; end: number } | null {
  const range = /第\s*(\d+)\s*[-~至到]\s*(\d+)\s*章/.exec(text);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return Number.isFinite(start) && Number.isFinite(end) && start >= 1 && end >= start ? { start, end } : null;
  }
  const single = /第\s*(\d+)\s*章/.exec(text);
  if (!single) return null;
  const chapter = Number(single[1]);
  return Number.isFinite(chapter) && chapter >= 1 ? { start: chapter, end: chapter } : null;
}
