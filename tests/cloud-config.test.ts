import { expect, it } from 'vitest'
import { resolveConfig } from '../src/cloud/config'

const config = {
  VITE_HERFIT_MODE: 'cloud',
  VITE_SUPABASE_URL: 'https://example.supabase.co/',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only',
}

it('defaults to demo but rejects partial or ambiguous cloud configuration', () => {
  expect(resolveConfig({}, false)).toEqual({ mode: 'demo' })
  expect(() => resolveConfig({ ...config, VITE_HERFIT_MODE: undefined }, false)).toThrow()
  expect(() => resolveConfig({ ...config, VITE_SUPABASE_URL: undefined }, false)).toThrow()
})

it('protects the cloud build from a private key or a non-root URL', () => {
  expect(resolveConfig(config, false)).toMatchObject({
    mode: 'cloud',
    url: 'https://example.supabase.co',
  })
  expect(() =>
    resolveConfig({ ...config, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test_only' }, false),
  ).toThrow()
  expect(() =>
    resolveConfig({ ...config, VITE_SUPABASE_URL: 'https://example.supabase.co/rest/v1' }, false),
  ).toThrow()
  expect(() =>
    resolveConfig({ ...config, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }, false),
  ).toThrow()
})
