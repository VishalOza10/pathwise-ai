import { z } from 'zod';
import { createSchemas } from './validation.js';
export const { idSchema, logoutSchema, loginSchema, completionSchema, alertSchema, assistantSchema, responseSchema } = createSchemas(z);
