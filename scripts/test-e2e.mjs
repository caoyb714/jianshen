import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const cloud = process.env.HERFIT_TEST_CLOUD === '1'
const port = cloud ? 4182 : 4173
const playwright = fileURLToPath(
  new URL('../node_modules/@playwright/test/cli.js', import.meta.url),
)
let server
try {
  if (!process.env.HERFIT_TEST_BASE_URL) {
    Object.assign(process.env, {
      VITE_HERFIT_MODE: cloud ? 'cloud' : 'demo',
      VITE_SUPABASE_URL: cloud ? 'https://herfit-stage2-test.supabase.co' : '',
      VITE_SUPABASE_PUBLISHABLE_KEY: cloud ? 'sb_publishable_stage2_test_only' : '',
      HERFIT_TEST_BASE_URL: `http://127.0.0.1:${port}`,
    })
    server = await createServer({
      cacheDir: cloud ? '.cache/vite-cloud-test' : '.cache/vite-demo-test',
      server: { host: '127.0.0.1', port, strictPort: true },
    })
    await server.listen()
  }
  process.exitCode = await new Promise((resolve, reject) => {
    const tester = spawn(process.execPath, [playwright, 'test', ...process.argv.slice(2)], {
      stdio: 'inherit',
    })
    tester.once('error', reject)
    tester.once('exit', (code) => resolve(code ?? 1))
  })
} finally {
  await server?.close()
}
