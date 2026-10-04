export function createSchemas(z) {
const idSchema = z.string().regex(/^[1-9]\d{0,8}$/).transform(Number);
const logoutSchema = z.strictObject({});
const loginSchema = z.strictObject({
  email: z.string().trim().email().max(120).transform(value => value.toLowerCase()),
  password: z.string().min(1).max(128),
});
const completionSchema = z.strictObject({ completed: z.boolean(), version: z.number().int().min(0).max(1000000) });
const alertSchema = z.strictObject({ status: z.enum(['reviewed','resolved']), version: z.number().int().min(0).max(1000000) });
const assistantSchema = z.strictObject({ message: z.string().trim().min(1).max(2000), studentId: z.number().int().positive().max(999999999).optional() });
const responseSchema = z.strictObject({
  kind: z.enum(['academic','boundary','missing']),
  summary: z.string().min(1).max(1600),
  priorities: z.array(z.string().min(1).max(400)).max(8),
  recommendedResources: z.array(z.number().int().positive()).max(5),
  needsAdvisor: z.boolean(),
});

return { idSchema, logoutSchema, loginSchema, completionSchema, alertSchema, assistantSchema, responseSchema };
}

