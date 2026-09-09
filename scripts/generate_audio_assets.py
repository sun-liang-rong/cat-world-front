"""Generate the original cat-town audio set.

The game uses these files as small, self-contained WAV assets.  The sound is
intentionally bright and bouncy rather than realistic: warm plucks for the
melody, soft bells for rewards, and rounded pops for touch feedback.
"""

from pathlib import Path

import numpy as np


SAMPLE_RATE = 22050
TAU = np.pi * 2.0
OUT_DIR = Path(__file__).resolve().parents[1] / 'assets' / 'resources' / 'audio'
RNG = np.random.default_rng(20260907)


def midi(note: int) -> float:
    return 440.0 * (2.0 ** ((note - 69) / 12.0))


def pan_gains(pan: float) -> tuple[float, float]:
    angle = (pan + 1.0) * 0.25 * np.pi
    return float(np.cos(angle)), float(np.sin(angle))


def add_signal(mix: np.ndarray, start: float, signal: np.ndarray, pan: float) -> None:
    start_frame = max(0, int(start * SAMPLE_RATE))
    end_frame = min(len(mix), start_frame + len(signal))
    if end_frame <= start_frame:
        return
    left, right = pan_gains(pan)
    signal = signal[:end_frame - start_frame]
    mix[start_frame:end_frame, 0] += signal * left
    mix[start_frame:end_frame, 1] += signal * right


def pluck(note: int, duration: float, volume: float) -> np.ndarray:
    t = np.arange(max(1, int(duration * SAMPLE_RATE)), dtype=np.float64) / SAMPLE_RATE
    frequency = midi(note)
    phase = TAU * frequency * t
    partials = (
        1.00 * np.sin(phase),
        0.42 * np.sin(phase * 2.0 + 0.02),
        0.19 * np.sin(phase * 3.0 + 0.05),
        0.08 * np.sin(phase * 4.0 + 0.08),
        0.035 * np.sin(phase * 5.0),
    )
    attack = np.minimum(1.0, t / 0.006)
    decay = np.exp(-t / max(0.08, duration * 0.38))
    body = np.exp(-t / max(0.12, duration * 0.72))
    return volume * (sum(partials) * decay * attack + 0.06 * np.sin(phase * 0.5) * body)


def bell(note: int, duration: float, volume: float) -> np.ndarray:
    t = np.arange(max(1, int(duration * SAMPLE_RATE)), dtype=np.float64) / SAMPLE_RATE
    frequency = midi(note)
    partials = (
        1.00 * np.sin(TAU * frequency * t) * np.exp(-t / 0.34),
        0.30 * np.sin(TAU * frequency * 2.01 * t + 0.08) * np.exp(-t / 0.22),
        0.15 * np.sin(TAU * frequency * 3.98 * t) * np.exp(-t / 0.15),
        0.08 * np.sin(TAU * frequency * 5.93 * t + 0.12) * np.exp(-t / 0.11),
    )
    attack = np.minimum(1.0, t / 0.004)
    return volume * sum(partials) * attack


def pad(notes: list[int], duration: float, volume: float) -> np.ndarray:
    t = np.arange(max(1, int(duration * SAMPLE_RATE)), dtype=np.float64) / SAMPLE_RATE
    attack = np.minimum(1.0, t / 0.16)
    release_start = max(0.0, duration - 0.24)
    release = np.where(t > release_start, np.maximum(0.0, (duration - t) / 0.24), 1.0)
    signal = np.zeros_like(t)
    for index, note in enumerate(notes):
        frequency = midi(note) * (1.0 + (index - 1.5) * 0.0015)
        signal += np.sin(TAU * frequency * t) * (0.8 / len(notes))
        signal += np.sin(TAU * frequency * 2.0 * t) * (0.09 / len(notes))
    return volume * signal * attack * release


def soft_noise(duration: float, volume: float, falling: bool = True) -> np.ndarray:
    length = max(1, int(duration * SAMPLE_RATE))
    noise = RNG.normal(0.0, 1.0, length)
    kernel = np.ones(9, dtype=np.float64) / 9.0
    noise = np.convolve(noise, kernel, mode='same')
    t = np.arange(length, dtype=np.float64) / SAMPLE_RATE
    envelope = np.minimum(1.0, t / 0.004)
    if falling:
        envelope *= np.maximum(0.0, 1.0 - t / duration) ** 1.8
    return noise * envelope * volume


def pop(duration: float, start_frequency: float, end_frequency: float, volume: float) -> np.ndarray:
    length = max(1, int(duration * SAMPLE_RATE))
    t = np.arange(length, dtype=np.float64) / SAMPLE_RATE
    frequency = end_frequency + (start_frequency - end_frequency) * np.exp(-t / 0.025)
    phase = TAU * np.cumsum(frequency) / SAMPLE_RATE
    envelope = np.exp(-t / max(0.025, duration * 0.45)) * np.minimum(1.0, t / 0.002)
    return np.sin(phase) * envelope * volume + soft_noise(duration, volume * 0.08)


def kick(duration: float = 0.16, volume: float = 0.08) -> np.ndarray:
    length = max(1, int(duration * SAMPLE_RATE))
    t = np.arange(length, dtype=np.float64) / SAMPLE_RATE
    frequency = 92.0 + 56.0 * np.exp(-t / 0.025)
    phase = TAU * np.cumsum(frequency) / SAMPLE_RATE
    return np.sin(phase) * np.exp(-t / 0.055) * volume


def write_wav(name: str, mix: np.ndarray, target_peak: float) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mix = np.tanh(mix * 1.12)
    peak = float(np.max(np.abs(mix))) or 1.0
    mix = mix * (target_peak / peak)
    fade_frames = min(int(SAMPLE_RATE * 0.014), len(mix) // 2)
    if fade_frames:
        fade = np.ones(len(mix))
        fade[:fade_frames] = np.linspace(0.0, 1.0, fade_frames)
        fade[-fade_frames:] = np.linspace(1.0, 0.0, fade_frames)
        mix *= fade[:, None]
    pcm = np.clip(mix * 32767.0, -32767, 32767).astype('<i2')
    import wave

    with wave.open(str(OUT_DIR / f'{name}.wav'), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm.tobytes())


def make_bgm() -> np.ndarray:
    bpm = 108.0
    beat = 60.0 / bpm
    bar = beat * 4.0
    bars = 16
    mix = np.zeros((int(bar * bars * SAMPLE_RATE), 2), dtype=np.float64)
    chords = [
        [48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59],
        [48, 55, 60, 64], [40, 47, 52, 55], [45, 52, 57, 60], [43, 50, 55, 59],
        [41, 48, 53, 57], [48, 55, 60, 64], [50, 57, 62, 65], [43, 50, 55, 59],
        [48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59],
    ]
    roots = [36, 33, 29, 31, 36, 28, 33, 31, 29, 36, 38, 31, 36, 33, 29, 31]
    melody = [
        [(0, 76, .42), (.5, 79, .38), (1, 81, .65), (2, 79, .4), (2.5, 76, .42), (3, 74, .58)],
        [(0, 76, .42), (.5, 79, .38), (1, 84, .65), (2, 81, .4), (2.5, 79, .42), (3, 76, .58)],
        [(0, 72, .42), (.5, 76, .38), (1, 79, .65), (2, 76, .4), (2.5, 74, .42), (3, 72, .58)],
        [(0, 74, .42), (.5, 76, .38), (1, 79, .65), (2, 76, .4), (2.5, 74, .42), (3, 71, .58)],
        [(0, 76, .42), (.5, 79, .38), (1, 81, .65), (2, 79, .4), (2.5, 76, .42), (3, 74, .58)],
        [(0, 71, .42), (.5, 74, .38), (1, 76, .65), (2, 74, .4), (2.5, 71, .42), (3, 69, .58)],
        [(0, 72, .42), (.5, 76, .38), (1, 79, .65), (2, 76, .4), (2.5, 74, .42), (3, 72, .58)],
        [(0, 74, .42), (.5, 76, .38), (1, 79, .65), (2, 76, .4), (2.5, 74, .42), (3, 71, .58)],
        [(0, 72, .42), (.5, 76, .38), (1, 79, .65), (2, 76, .4), (2.5, 72, .42), (3, 69, .58)],
        [(0, 76, .42), (.5, 79, .38), (1, 81, .65), (2, 79, .4), (2.5, 76, .42), (3, 74, .58)],
        [(0, 77, .42), (.5, 81, .38), (1, 83, .65), (2, 81, .4), (2.5, 77, .42), (3, 76, .58)],
        [(0, 74, .42), (.5, 76, .38), (1, 79, .65), (2, 76, .4), (2.5, 74, .42), (3, 71, .58)],
        [(0, 76, .42), (.5, 79, .38), (1, 81, .65), (2, 79, .4), (2.5, 76, .42), (3, 74, .58)],
        [(0, 72, .42), (.5, 76, .38), (1, 79, .65), (2, 76, .4), (2.5, 74, .42), (3, 72, .58)],
        [(0, 72, .42), (.5, 76, .38), (1, 79, .65), (2, 76, .4), (2.5, 72, .42), (3, 69, .58)],
        [(0, 74, .42), (.5, 76, .38), (1, 79, .72), (2, 76, .4), (2.5, 74, .42), (3, 72, .7)],
    ]
    for bar_index, chord in enumerate(chords):
        start = bar_index * bar
        add_signal(mix, start, pad(chord, bar, 0.10), 0.0)
        for beat_index in (0, 2):
            add_signal(mix, start + beat_index * beat, pluck(roots[bar_index], beat * .9, .22), 0.0)
        for eighth in range(8):
            shaker = soft_noise(.055, .012 if eighth % 2 else .008)
            add_signal(mix, start + eighth * beat / 2.0, shaker, -0.3 if eighth % 2 else 0.3)
        for beat_index, chord_note in enumerate((chord[1], chord[2], chord[3], chord[2])):
            add_signal(mix, start + (beat_index + .5) * beat, pluck(chord_note + 12, beat * .48, .055), .26 if beat_index % 2 else -.26)
        add_signal(mix, start, kick(), 0.0)
        add_signal(mix, start + 2 * beat, kick(.13, .052), 0.0)
        for beat_index in (1, 3):
            add_signal(mix, start + beat_index * beat, soft_noise(.075, .025), .18 if beat_index == 1 else -.18)
        for offset, note, length in melody[bar_index]:
            add_signal(mix, start + offset * beat, pluck(note, length * beat, .17), -.13 if int(offset * 2) % 2 else .16)
            add_signal(mix, start + (offset + .22) * beat, bell(note + 12, length * beat * .72, .018), .35)
    return mix


def make_effect(name: str) -> np.ndarray:
    if name == 'click':
        mix = np.zeros((int(.13 * SAMPLE_RATE), 2), dtype=np.float64)
        add_signal(mix, 0.0, pop(.085, 520, 290, .30), -.1)
        add_signal(mix, .018, bell(84, .12, .055), .18)
        return mix
    if name == 'collect':
        mix = np.zeros((int(.34 * SAMPLE_RATE), 2), dtype=np.float64)
        add_signal(mix, 0.0, pluck(79, .20, .24), -.22)
        add_signal(mix, .075, pluck(84, .22, .22), .18)
        add_signal(mix, .15, bell(88, .28, .20), .34)
        add_signal(mix, .12, soft_noise(.18, .025), .3)
        return mix
    if name == 'match':
        mix = np.zeros((int(.44 * SAMPLE_RATE), 2), dtype=np.float64)
        add_signal(mix, 0.0, pop(.08, 470, 270, .18), -.2)
        for offset, note, pan in ((.02, 79, -.28), (.09, 84, 0.0), (.16, 88, .28), (.24, 91, .08)):
            add_signal(mix, offset, bell(note, .3, .19), pan)
        add_signal(mix, .11, soft_noise(.25, .018), .35)
        return mix
    if name == 'win':
        mix = np.zeros((int(1.36 * SAMPLE_RATE), 2), dtype=np.float64)
        for offset, note, pan in ((0.0, 72, -.28), (.11, 76, -.12), (.22, 79, .12), (.36, 84, .3), (.54, 88, 0.0)):
            add_signal(mix, offset, pluck(note, .65 if offset > .3 else .38, .22), pan)
            add_signal(mix, offset + .02, bell(note + 12, .65 if offset > .3 else .38, .05), -pan)
        add_signal(mix, .35, pad([72, 76, 79, 84], .88, .12), 0.0)
        add_signal(mix, .48, soft_noise(.64, .04), .25)
        add_signal(mix, .70, soft_noise(.46, .025), -.32)
        return mix
    if name == 'fail':
        mix = np.zeros((int(.68 * SAMPLE_RATE), 2), dtype=np.float64)
        add_signal(mix, 0.0, pluck(69, .34, .18), -.08)
        add_signal(mix, .2, pluck(65, .40, .16), .08)
        add_signal(mix, .41, bell(62, .28, .08), .12)
        return mix
    raise ValueError(name)


if __name__ == '__main__':
    write_wav('bgm', make_bgm(), .78)
    for effect_name in ('click', 'collect', 'match', 'win', 'fail'):
        write_wav(effect_name, make_effect(effect_name), .72)
