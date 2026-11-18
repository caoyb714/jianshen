import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../functions/api/explain'
import { buildBasisPayload } from '../src/domain/ai'
import { makeSeed, PROFILE_A } from '../src/domain/seed'

/**
 * 条目化依据的边界比成功路径更重要：
 * 模型可以编造理由，但不能编造数字，也不能新增条目。
 */
const key = 'test-key-not-a-real-secret'

const payload = {
  planVersion: 3,
  profile: { age: 30, experience: '偶尔运动', equipment: ['哑铃'], restrictionsConfirmed: true },
  day: {
    focus: '推与核心',
    slots: [{ name: '哑铃卧推', sets: 3, target: '8-12 次', role: '主要' }],
  },
  items: [
    {
      sig: 'dumbbell-bench:increase:2.5',
      name: '哑铃卧推',
      label: '+2.5 kg',
      evidence: { reps: 10, load: 10, difficulty: 7 },
    },
  ],
}

let ipSeq = 0
function nextIp() {
  ipSeq += 1
  return `203.0.113.${ipSeq}`
}

function call(body: unknown, options: { key?: string } = {}) {
  return onRequest({
    request: new Request('https://herfit.test/api/explain', {
      method: 'POST',
      headers: { 'cf-connecting-ip': nextIp() },
      body: JSON.stringify(body),
    }),
    env: { DEEPSEEK_API_KEY: options.key ?? key },
  })
}

function upstream(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('条目化依据', () => {
  it('按 sig 返回每条理由', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        upstream(
          JSON.stringify({
            items: [{ sig: payload.items[0].sig, text: '上次 10 次很稳，负荷加 2.5 kg。' }],
          }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const body = (await (await call(payload)).json()) as {
      ok: boolean
      items: Array<{ sig: string; text: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].sig).toBe(payload.items[0].sig)
  })

  it('丢弃不在白名单里的 sig', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        upstream(
          JSON.stringify({
            items: [
              { sig: 'made-up', text: '这条不该出现，10 次。' },
              { sig: payload.items[0].sig, text: '上次 10 次很稳。' },
            ],
          }),
        ),
      ),
    )
    const body = (await (await call(payload)).json()) as {
      items: Array<{ sig: string; text: string }>
    }
    expect(body.items.map((item) => item.sig)).toEqual([payload.items[0].sig])
  })

  it('编造数字的理由整条丢弃，不降到自由发挥', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        upstream(
          JSON.stringify({
            items: [{ sig: payload.items[0].sig, text: '上次 12 次，可以再加 5 kg。' }],
          }),
        ),
      ),
    )
    const body = (await (await call(payload)).json()) as { items: unknown[] }
    expect(body.items).toEqual([])
  })

  it('模型没按 JSON 输出时返回空数组而不是报错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(upstream('这段理由不是 JSON，但看起来很正常。')),
    )
    const response = await call(payload)
    expect(await response.json()).toEqual({ ok: true, items: [] })
  })

  it('签名重复按坏请求处理', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const duplicated = { ...payload, items: [payload.items[0], payload.items[0]] }
    expect(await (await call(duplicated)).json()).toEqual({ ok: false, reason: 'bad-request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('超过 6 条按坏请求处理', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const many = {
      ...payload,
      items: Array.from({ length: 7 }, (_, index) => ({
        ...payload.items[0],
        sig: `sig-${index}`,
      })),
    }
    expect(await (await call(many)).json()).toEqual({ ok: false, reason: 'bad-request' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('buildBasisPayload', () => {
  it('只带条目与实测数字，不含体重与昵称', () => {
    const data = makeSeed()
    const profile = data.profiles.find((item) => item.id === PROFILE_A)!.profile!
    const day = {
      index: 0,
      kind: '训练' as const,
      focus: '推与核心',
      estimatedMinutes: 30,
      slots: [
        {
          exerciseId: 'goblet-squat',
          role: '主要' as const,
          sets: 3,
          target: { type: 'reps' as const, min: 8, max: 12 },
        },
      ],
    }
    const built = buildBasisPayload({
      profile,
      day,
      planVersion: 3,
      workouts: data.workouts,
      today: '2026-11-18',
      items: [
        {
          sig: 'x:increase:2.5',
          name: '哑铃卧推',
          label: '+2.5 kg',
          evidence: { reps: 10, load: 10, difficulty: 7 },
        },
      ],
    })
    const text = JSON.stringify(built)
    expect(text).not.toContain('weight')
    expect(text).not.toContain(profile.name)
    expect(built.items).toHaveLength(1)
    expect(built.planVersion).toBe(3)
  })
})
