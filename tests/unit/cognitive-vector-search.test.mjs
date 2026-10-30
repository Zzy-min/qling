import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { CognitiveIndex } from '../../dist/memory/cognitive-index.js';

test('vector retrieval loads metadata only for selected results and preserves stable ties', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qling-vector-'));
  const index = new CognitiveIndex(dir);
  await index.init();
  const db = new Database(join(dir, 'cognitive_knowledge.db'));
  try {
    for (const [id, vector] of [['first', [1, 0]], ['second', [1, 0]], ['loser', [0, 1]]]) {
      index.upsertVector({ id, content: id, source: 'test', importance: 0.7, createdAt: 1 }, vector);
    }
    db.prepare("UPDATE embeddings SET metadata = 'invalid json' WHERE id = 'loser'").run();
    assert.deepEqual(index.searchVector([1, 0], 2).map(r => r.entry.id), ['first', 'second']);
    assert.deepEqual(index.searchVector([1, 0], 0), []);
    index.upsertVector({ id: 'second', content: 'updated', source: 'test', importance: 0.7, createdAt: 1 }, [-1, 0]);
    assert.equal(index.searchVector([1, 0], 1)[0].entry.id, 'first');
  } finally {
    db.close();
    index.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('bounded vector ranking matches exhaustive cosine ranking across limits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qling-vector-rank-'));
  const index = new CognitiveIndex(dir);
  await index.init();
  try {
    const query = [0.3, -0.7, 0.2];
    const vectors = Array.from({ length: 200 }, (_, n) =>
      Array.from(new Float32Array([Math.sin(n), Math.cos(n * 3), (n % 7) - 3])));
    vectors.push([0, 0, 0], [1, 0]);
    const norm = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    const expected = vectors.map((v, n) => {
      index.upsertVector({ id: String(n), content: '中文', source: 'test', importance: 0.7, createdAt: 1 }, v);
      const score = v.length === query.length
        ? query.reduce((s, x, i) => s + x * v[i], 0) / (norm(query) * norm(v)) : 0;
      return { id: String(n), score: Number.isNaN(score) ? 0 : score };
    }).sort((a, b) => b.score - a.score);
    for (const limit of [1, 5, 10, 100, 300]) {
      assert.deepEqual(index.searchVector(query, limit).map(r => r.entry.id), expected.slice(0, limit).map(r => r.id));
    }
    assert.equal(index.searchVector([0, 0, 0], 1)[0].entry.id, '0');
  } finally {
    index.close();
    await rm(dir, { recursive: true, force: true });
  }
});
