import { Mware, Router } from '@neabyte/deserve'
import { getPort, getRoutesDir, getStaticImgRoot } from '@app/api/Config.ts'
import Logger from '@app/Logger.ts'

export function createRouter(): Router {
  const router = new Router({ routesDir: getRoutesDir() })
  router.use(Mware.cors({ origin: '*' }))
  router.static('/public/img', { path: getStaticImgRoot() })
  return router
}

export async function serve(signal?: AbortSignal): Promise<void> {
  const router = createRouter()
  const port = getPort()
  await router.serve(port, '0.0.0.0', signal)
  Logger.info(`[IDX API] http://localhost:${port}`)
}

if (import.meta.main) {
  await serve()
}
