import { LevelGenerator } from '../assets/scripts/level/LevelGenerator';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[KindSequence] ${message}`);
}

function looksLikeWholeBoardFallback(kinds: number[]) {
  if (kinds.length < 12) return false;
  const kindCount = Math.max(...kinds) + 1;
  const expected: number[] = [];
  const groups = kinds.length / 3;
  const pairChunks = Math.floor(groups / 2);
  for (let chunk = 0; chunk < pairChunks; chunk += 1) {
    const first = (chunk * 2) % kindCount;
    const second = (chunk * 2 + 1) % kindCount;
    for (let index = 0; index < 3; index += 1) expected.push(first, second);
  }
  if (groups % 2 === 1) {
    const kind = (pairChunks * 2) % kindCount;
    expected.push(kind, kind, kind);
  }
  if (expected.length !== kinds.length) return false;
  return expected.every((kind, index) => kind === kinds[index]);
}

function testLevelsDoNotUseWholeBoardFallback() {
  const generator = new LevelGenerator();
  for (let level = 2; level <= 12; level += 1) {
    const definition = generator.generate({
      level,
      seed: 1000 + level * 17,
      maxAttempts: 24,
    });
    const kinds = definition.plan.plannedKinds;
    assert(kinds.length === definition.tiles.length, `level ${level} should assign every tile`);
    assert(!looksLikeWholeBoardFallback(kinds), `level ${level} should not collapse to the old ABAB fallback`);
    const counts = new Map<number, number>();
    kinds.forEach(kind => counts.set(kind, (counts.get(kind) || 0) + 1));
    counts.forEach((count, kind) => {
      assert(count % 3 === 0, `level ${level} kind ${kind} must stay a multiple of three`);
    });
  }
}

testLevelsDoNotUseWholeBoardFallback();
process.stdout.write('Kind sequence validation passed: local rewind, no whole-board fallback.\n');
