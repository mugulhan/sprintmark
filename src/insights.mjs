const STATUS_ORDER = new Map(
  ["in_progress", "review", "waiting", "planned", "backlog", "done"].map(
    (status, index) => [status, index],
  ),
);

export function cycleMinutes(item, now = Date.now()) {
  if (!item.started_at) return null;
  const start = Date.parse(item.started_at);
  const end = item.completed_at ? Date.parse(item.completed_at) : Number(now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null;
  return Math.max(0, Math.round((end - start) / 60000));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function buildProjectInsights(
  records,
  { filter = "all", sort = "updated", page = 1, pageSize = 20, now } = {},
) {
  const tasks = records.filter((item) => item.kind === "task");
  const estimated = tasks.filter((item) =>
    Number.isInteger(item.estimate_minutes),
  );
  const completedMeasured = tasks.filter(
    (item) => item.status === "done" && cycleMinutes(item, now) !== null,
  );
  const statusEstimateMinutes = {};
  for (const item of estimated)
    statusEstimateMinutes[item.status] =
      (statusEstimateMinutes[item.status] || 0) + item.estimate_minutes;
  const summaries = tasks.map((item) => ({
    key: item.key,
    uid: item.uid,
    slug: item.slug,
    title: item.title,
    status: item.status,
    assignee_id: item.assignee_id || null,
    estimate_minutes: item.estimate_minutes ?? null,
    started_at: item.started_at || null,
    completed_at: item.completed_at || null,
    cycle_minutes: cycleMinutes(item, now),
    updated_at: item.updated_at,
  }));
  const filtered = summaries.filter((item) => {
    if (filter === "open") return item.status !== "done";
    if (filter === "done") return item.status === "done";
    if (filter === "unestimated") return item.estimate_minutes === null;
    return true;
  });
  filtered.sort((left, right) => {
    if (sort === "estimate")
      return (right.estimate_minutes ?? -1) - (left.estimate_minutes ?? -1);
    if (sort === "actual")
      return (right.cycle_minutes ?? -1) - (left.cycle_minutes ?? -1);
    if (sort === "status")
      return (
        (STATUS_ORDER.get(left.status) ?? 99) -
        (STATUS_ORDER.get(right.status) ?? 99)
      );
    return String(right.updated_at).localeCompare(String(left.updated_at));
  });
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const pageCount = Math.max(1, Math.ceil(filtered.length / safePageSize));
  const safePage = Math.min(pageCount, Math.max(1, Number(page) || 1));
  const offset = (safePage - 1) * safePageSize;
  return {
    summary: {
      total: tasks.length,
      estimated_count: estimated.length,
      total_estimate_minutes: estimated.reduce(
        (sum, item) => sum + item.estimate_minutes,
        0,
      ),
      remaining_estimate_minutes: estimated
        .filter((item) => item.status !== "done")
        .reduce((sum, item) => sum + item.estimate_minutes, 0),
      completed_estimate_minutes: estimated
        .filter((item) => item.status === "done")
        .reduce((sum, item) => sum + item.estimate_minutes, 0),
      measured_completed_count: completedMeasured.length,
      median_cycle_minutes: median(
        completedMeasured.map((item) => cycleMinutes(item, now)),
      ),
      status_estimate_minutes: statusEstimateMinutes,
    },
    items: filtered.slice(offset, offset + safePageSize),
    pagination: {
      page: safePage,
      page_size: safePageSize,
      page_count: pageCount,
      total: filtered.length,
    },
  };
}
