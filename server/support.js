export const APPROVED_LINKS = Object.freeze({
  study: 'https://learningcenter.unc.edu/tips-and-tools/using-planners/',
  writing: 'https://owl.purdue.edu/owl/general_writing/index.html',
  learning: 'https://learningcenter.unc.edu/tips-and-tools/',
});

export function supportIndicators(assignments, grades, now = Date.now()) {
  const overdue = assignments.filter(a => !a.completed && Date.parse(a.due_at) < now);
  const upcoming = assignments.filter(a => !a.completed && Date.parse(a.due_at) >= now && Date.parse(a.due_at) <= now + 5 * 86400000);
  const byCourse = Map.groupBy(grades, g => g.course_id);
  const declines = [...byCourse.values()].flatMap(items => {
    const ordered = [...items].sort((a,b) => a.observed_at.localeCompare(b.observed_at));
    if (ordered.length < 2) return [];
    const previous = ordered.at(-2); const latest = ordered.at(-1);
    return previous.score - latest.score >= 5 ? [{ course: latest.course_title, previous: previous.score, current: latest.score }] : [];
  });
  const factors = [];
  if (overdue.length) factors.push(`${overdue.length} overdue assignment${overdue.length === 1 ? '' : 's'}`);
  for (const decline of declines) factors.push(`${decline.course}: latest assessment ${decline.current}%, previous ${decline.previous}%`);
  if (upcoming.length >= 3) factors.push(`${upcoming.length} assignments due within 5 days`);
  const hasData = assignments.length > 0 || grades.length > 0;
  const level = !hasData ? 'unknown' : overdue.length >= 3 || (overdue.length >= 2 && declines.length > 0) ? 'elevated' : factors.length ? 'moderate' : 'steady';
  return {
    level, factors, overdue: overdue.length, upcoming: upcoming.length,
    reasoning: !hasData ? 'Not enough data yet' : factors.length ? 'These recorded workload and assessment signals suggest that a check-in may help.' : 'No current support flags in the recorded data.',
    action: !hasData ? 'Ask your advisor or instructor to confirm your academic information.' : level === 'elevated' ? 'Review overdue work and consider an advisor check-in.' : level === 'moderate' ? 'Review your workload and plan the next study block.' : 'Keep reviewing your deadlines each week.',
    calculatedAt: new Date(now).toISOString(),
  };
}

