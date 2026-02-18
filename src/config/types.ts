import { z } from "zod"
import { ArgusConfigSchema } from "./schema"

export type ArgusConfig = z.infer<typeof ArgusConfigSchema>
