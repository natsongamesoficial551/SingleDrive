import { z } from 'zod'

const browseQuerySchema = z.object({
  folderId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).default('root'),
  pageToken: z.string().min(1).max(2048).optional(),
  shared: z.enum(['true', 'false']).default('false'),
})

export function parseGoogleBrowseQuery(value: unknown) {
  const query = browseQuerySchema.parse(value)
  return {
    ...query,
    driveQuery: query.shared === 'true' && query.folderId === 'root'
      ? 'sharedWithMe = true and trashed = false'
      : `'${query.folderId}' in parents and trashed = false`,
  }
}
