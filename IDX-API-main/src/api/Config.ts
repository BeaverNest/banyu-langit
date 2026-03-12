const DEFAULT_PORT = 52060
const DEFAULT_ROUTES_DIR = './src/api/routes'
const DEFAULT_STATIC_IMG_ROOT = './sample/img'

export function getPort(): number {
  const envPort = Deno.env.get('PORT')
  if (envPort === undefined || envPort === '') {
    return DEFAULT_PORT
  }
  const parsed = Number(envPort)
  return Number.isNaN(parsed) || parsed < 1 || parsed > 65535 ? DEFAULT_PORT : parsed
}

export function getRoutesDir(): string {
  return DEFAULT_ROUTES_DIR
}

export function getStaticImgRoot(): string {
  return DEFAULT_STATIC_IMG_ROOT
}
