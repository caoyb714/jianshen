/**
 * 组间休息的提示音。
 *
 * 浏览器要求音频必须在用户手势中解锁，所以在开始训练、点击组次时调用 unlockAudio()。
 * 任何环节失败都静默跳过——没有声音也不能影响训练本身。
 */

let context: AudioContext | null = null

export function unlockAudio() {
  try {
    if (!context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      context = new Ctor()
    }
    if (context.state === 'suspended') void context.resume()
  } catch {
    /* 不支持音频的浏览器直接忽略 */
  }
}

/** 两声短提示，足够穿透耳机但不刺耳 */
export function playRestChime() {
  try {
    unlockAudio()
    if (!context) return
    const start = context.currentTime
    const notes: Array<[number, number]> = [
      [0, 880],
      [0.18, 1174.66],
    ]
    for (const [offset, frequency] of notes) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(start + offset)
      oscillator.stop(start + offset + 0.2)
    }
  } catch {
    /* 播放失败不影响训练 */
  }
}
