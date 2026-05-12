import type { z } from "zod"
import type { ArgusConfigSchema } from "./schema"

export type ArgusConfig = z.infer<typeof ArgusConfigSchema>
