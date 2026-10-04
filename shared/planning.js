export function planningSchemas(z) {
  const text = n => z.string().trim().min(1).max(n);
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
  const version = z.number().int().min(0).max(1000000);
  const priority = z.enum(['high','medium','low']);
  const preferences = z.strictObject({ goal:text(240), hours:z.number().min(0.5).max(40), weeks:z.number().int().min(1).max(52), target:date.nullable(), constraints:z.string().trim().max(600), strategy:z.enum(['balanced','gentle','focused']) });
  const task = z.strictObject({ id:text(80), title:text(240), minutes:z.number().int().min(5).max(480), priority, completed:z.boolean(), assignmentId:z.number().int().positive().nullable(), deadline:date.nullable(), scheduled:date.nullable(), notBefore:date.nullable().optional(), slots:z.array(z.strictObject({date,minutes:z.number().positive().max(480)})).max(240).optional(), dependsOn:z.array(text(80)).max(4), reason:text(500) });
  const plan = z.strictObject({ version, preferences, tasks:z.array(task).max(32), known:z.array(text(500)).max(8), assumptions:z.array(text(500)).max(8), risks:z.array(text(500)).max(12), milestones:z.array(z.strictObject({title:text(150), date, taskIds:z.array(text(80)).max(32)})).max(54), nextAction:text(500), summary:text(1000), updatedAt:z.string().datetime() });
  return { preferences, plan,
    generate:z.strictObject({version, preferences}),
    revise:z.strictObject({version,message:text(2000),confirmed:z.boolean().optional()}),
    undo:z.strictObject({version}),
    edit:z.strictObject({version,taskId:text(80),changes:z.strictObject({title:text(240).optional(),minutes:z.number().int().min(5).max(480).optional(),priority:priority.optional(),completed:z.boolean().optional(),notBefore:date.nullable().optional()}).refine(v => Object.keys(v).length>0)}),
    reorder:z.strictObject({version,taskIds:z.array(text(80)).max(32).refine(ids=>new Set(ids).size===ids.length)}),
    add:z.strictObject({version,title:text(240),minutes:z.number().int().min(5).max(480),priority}),
    remove:z.strictObject({version,taskId:text(80)}),
  };
}
