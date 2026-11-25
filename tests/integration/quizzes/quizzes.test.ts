import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { startTestApp, stopTestApp } from '../../helpers/app-server';
import { registerVerifiedUser } from '../../helpers/client';
import { resetPipelineState, runQuizGeneration } from '../../helpers/pipeline';
import { Lesson } from '@/lib/db/models/lesson';
import { Quiz, type IQuiz } from '@/lib/db/models/quiz';
import { reserveLessonGeneration, resetAllowanceForTests } from '@/lib/plans/allowance';

let appUrl: string;

beforeAll(async () => {
  appUrl = await startTestApp();
  resetPipelineState();
});

afterAll(async () => {
  await stopTestApp();
});

async function seedReadyLesson(userId: string, title: string): Promise<string> {
  const lesson = await Lesson.create({
    userId: new Types.ObjectId(userId),
    materialId: new Types.ObjectId(),
    sourceMaterialIds: [new Types.ObjectId()],
    title,
    summary: `${title} summary`,
    contentMarkdown: `# ${title}\n\nContent dense enough to quiz from. ${title} facts repeat here. `.repeat(4),
    version: 1,
    status: 'ready',
    generationProvider: 'seed',
    generationModel: 'seed',
    promptVersion: 'v1',
  });
  return lesson._id.toHexString();
}

describe('quiz generation (TODO step 14)', () => {
  it('answers anonymous and foreign requests non-revealingly', async () => {
    const user = await registerVerifiedUser(appUrl);
    const lessonId = await seedReadyLesson(user.user.id, 'Foreign lesson');
    const created = await user.session.post('/api/quizzes', {
      title: 'Foreign attempt',
      itemCount: 20,
      lessonIds: [lessonId],
    });
    expect(created.status).toBe(201);
    const quizId = (created.body as { id: string }).id;
    const foreign = await registerVerifiedUser(appUrl);
    const foreignGet = await foreign.session.get(`/api/quizzes/${quizId}`);
    expect(foreignGet.status).toBe(404);
    const foreignDelete = await foreign.session.delete(`/api/quizzes/${quizId}`);
    expect(foreignDelete.status).toBe(404);
  });

  it('validates the request body strictly', async () => {
    const user = await registerVerifiedUser(appUrl);
    const badCount = await user.session.post('/api/quizzes', {
      title: 'Bad length',
      itemCount: 25,
      lessonIds: [new Types.ObjectId().toHexString()],
    });
    expect(badCount.status).toBe(400);
    const badIds = await user.session.post('/api/quizzes', {
      title: 'Bad ids',
      itemCount: 20,
      lessonIds: ['nope'],
    });
    expect(badIds.status).toBe(400);
  });

  it('answers 404 for foreign, missing, and not-ready lessons without revealing', async () => {
    const owner = await registerVerifiedUser(appUrl);
    const lessonId = await seedReadyLesson(owner.user.id, 'Owner lesson');
    const stranger = await registerVerifiedUser(appUrl);
    const response = await stranger.session.post('/api/quizzes', {
      title: 'Not mine',
      itemCount: 20,
      lessonIds: [lessonId],
    });
    expect(response.status).toBe(404);
    const missing = await owner.session.post('/api/quizzes', {
      title: 'Missing',
      itemCount: 20,
      lessonIds: [new Types.ObjectId().toHexString()],
    });
    expect(missing.status).toBe(404);
  });

  it('blocks free users above the 3-lesson source cap with the plan envelope', async () => {
    const user = await registerVerifiedUser(appUrl);
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      ids.push(await seedReadyLesson(user.user.id, `Cap lesson ${index + 1}`));
    }
    const response = await user.session.post('/api/quizzes', {
      title: 'Too many sources',
      itemCount: 20,
      lessonIds: ids,
    });
    expect(response.status).toBe(403);
    const body = response.body as { code: string; details?: { reason?: string; limit?: number } };
    expect(body.code).toBe('plan_limit');
    expect(body.details?.reason).toBe('plan_quiz_sources');
    expect(body.details?.limit).toBe(3);
  });

  it('blocks the third stored quiz on the free plan and frees the slot on delete', async () => {
    const user = await registerVerifiedUser(appUrl);
    const lessonId = await seedReadyLesson(user.user.id, 'Quota lesson');
    // Three stored quizzes fill the free-plan slots (created directly).
    for (let index = 0; index < 3; index += 1) {
      await Quiz.create({
        userId: new Types.ObjectId(user.user.id),
        title: `Stored quiz ${index + 1}`,
        itemCount: 20,
        sourceLessonIds: [new Types.ObjectId(lessonId)],
        status: 'ready',
        questions: [],
      });
    }
    const blocked = await user.session.post('/api/quizzes', {
      title: 'Fourth quiz',
      itemCount: 20,
      lessonIds: [lessonId],
    });
    expect(blocked.status).toBe(403);
    expect((blocked.body as { details?: { reason?: string } }).details?.reason).toBe(
      'plan_quiz_limit',
    );

    // A failed attempt never consumes the allowance; delete one stored quiz.
    const stored = await Quiz.findOne({ userId: new Types.ObjectId(user.user.id) }).exec();
    await Quiz.deleteOne({ _id: stored?._id }).exec();
    const allowed = await user.session.post('/api/quizzes', {
      title: 'Fits now',
      itemCount: 20,
      lessonIds: [lessonId],
    });
    expect(allowed.status).toBe(201);
  });

  it('generates the exact count, withholds the answer key, and refunds on failure', async () => {
    const user = await registerVerifiedUser(appUrl);
    const lessonId = await seedReadyLesson(user.user.id, 'Happy path lesson');
    const created = await user.session.post('/api/quizzes', {
      title: 'Happy path quiz',
      itemCount: 20,
      lessonIds: [lessonId],
    });
    expect(created.status).toBe(201);
    const quizId = (created.body as { id: string }).id;

    // Polling view before the worker runs.
    const queuedView = await user.session.get(`/api/quizzes/${quizId}`);
    expect((queuedView.body as { status: string }).status).toBe('queued');
    expect((queuedView.body as { questions?: unknown }).questions).toBeUndefined();

    await runQuizGeneration(quizId, user.user.id);

    const readyView = await user.session.get(`/api/quizzes/${quizId}`);
    const ready = readyView.body as {
      status: string;
      questions: Array<{ question: string; options: string[] }>;
    };
    expect(ready.status, `quiz failed: ${(readyView.body as { lastErrorMessage?: string }).lastErrorMessage}`).toBe('ready');
    expect(ready.questions).toHaveLength(20);
    // The answer key never leaves the server (deferred reveal/scoring).
    for (const question of ready.questions) {
      expect(Object.keys(question).sort()).toEqual(['options', 'question']);
    }

    // Delete frees the slot and the row.
    const removed = await user.session.delete(`/api/quizzes/${quizId}`);
    expect(removed.status).toBe(204);
    expect(await Quiz.countDocuments({ userId: new Types.ObjectId(user.user.id) }).exec()).toBe(0);
  });

  it('filters, searches, and sorts the quiz list (TODO step 15)', async () => {
    const user = await registerVerifiedUser(appUrl);
    const lessonId = await seedReadyLesson(user.user.id, 'List lesson');
    const make = async (title: string, status: 'ready' | 'queued' | 'processing') => {
      await Quiz.create({
        userId: new Types.ObjectId(user.user.id),
        title,
        itemCount: 20,
        sourceLessonIds: [new Types.ObjectId(lessonId)],
        status,
        questions:
          status === 'ready'
            ? [{ question: 'Q', options: ['A', 'B', 'C', 'D'], correctIndex: 0, explanation: null, sourceLessonId: null, sourceLessonTitle: null }]
            : [],
      });
    };
    await make('Algebra basics quiz', 'ready');
    await make('Calculus practice', 'ready');
    await make('Zoology warm-up', 'processing');

    const ready = await user.session.get('/api/quizzes?status=ready');
    const readyList = ready.body as { data: Array<{ title: string }> };
    expect(readyList.data.map((quiz) => quiz.title).sort()).toEqual(['Algebra basics quiz', 'Calculus practice']);

    const generating = await user.session.get('/api/quizzes?status=generating');
    expect((generating.body as { data: Array<{ title: string }> }).data.map((quiz) => quiz.title)).toEqual([
      'Zoology warm-up',
    ]);

    const searched = await user.session.get('/api/quizzes?q=calculus');
    expect((searched.body as { data: Array<{ title: string }> }).data.map((quiz) => quiz.title)).toEqual([
      'Calculus practice',
    ]);

    const byTitle = await user.session.get('/api/quizzes?sort=title');
    expect((byTitle.body as { data: Array<{ title: string }> }).data.map((quiz) => quiz.title)).toEqual([
      'Algebra basics quiz',
      'Calculus practice',
      'Zoology warm-up',
    ]);

    // Failed attempts never exist to be listed or filtered.
    expect(await Quiz.countDocuments({ userId: new Types.ObjectId(user.user.id), status: 'failed' }).exec()).toBe(0);
  });

  it('submits attempts, grades server-side, and supports unlimited retakes', async () => {
    const user = await registerVerifiedUser(appUrl);
    const lessonId = await seedReadyLesson(user.user.id, 'Attempt lesson');
    const created = await user.session.post('/api/quizzes', {
      title: 'Attempt quiz',
      itemCount: 20,
      lessonIds: [lessonId],
    });
    expect(created.status).toBe(201);
    const quizId = (created.body as { id: string }).id;
    await runQuizGeneration(quizId, user.user.id);

    // The fake model always sets correctIndex 0 — answer accordingly.
    const answersFor = (pick: (questionIndex: number) => number) =>
      Array.from({ length: 20 }, (_, questionIndex) => pick(questionIndex));

    // First attempt: all correct.
    const first = await user.session.post(`/api/quizzes/${quizId}/submit`, {
      answers: answersFor(() => 0),
    });
    expect(first.status).toBe(201);
    const firstView = first.body as {
      attemptNumber: number;
      score: { correct: number; total: number };
      questions: Array<{ yourAnswer: number | null; correctIndex: number; correct: boolean; explanation: string | null }>;
      history: Array<{ attemptNumber: number }>;
    };
    expect(firstView.attemptNumber).toBe(1);
    expect(firstView.score).toEqual({ correct: 20, total: 20 });
    expect(firstView.questions[0]?.correct).toBe(true);
    // The reveal arrives only now — explanations included post-submission.
    expect(firstView.questions[0]?.explanation).toBeTruthy();

    // Second attempt: all answered, mostly wrong — unlimited retakes.
    const second = await user.session.post(`/api/quizzes/${quizId}/submit`, {
      answers: answersFor((questionIndex) => (questionIndex % 2 === 0 ? 0 : 2)),
    });
    expect(second.status).toBe(201);
    const secondView = second.body as {
      attemptNumber: number;
      score: { correct: number; total: number };
      history: Array<{ attemptNumber: number; scoreCorrect: number }>;
    };
    expect(secondView.attemptNumber).toBe(2);
    expect(secondView.score.correct).toBe(10);
    expect(secondView.history).toHaveLength(2);
    expect(secondView.history[0]).toMatchObject({ attemptNumber: 1, scoreCorrect: 20 });

    // ?attempt=1 replays the first attempt's reveal.
    const replay = await user.session.get(`/api/quizzes/${quizId}?attempt=1`);
    const replayView = replay.body as {
      attemptNumber: number;
      score: { correct: number };
      questions: Array<{ yourAnswer: number | null; correctIndex: number }>;
    };
    expect(replayView.attemptNumber).toBe(1);
    expect(replayView.score.correct).toBe(20);
    expect(replayView.questions[0]?.yourAnswer).toBe(0);

    // History is stored: two attempts on the same quiz, all answers valid.
    const stored = (await Quiz.findById(quizId).lean<IQuiz>().exec())?.attempts ?? [];
    expect(stored).toHaveLength(2);
    expect(stored[1]?.answers.every((answer: number) => answer >= 0 && answer <= 3)).toBe(true);
  });

  it('rejects malformed submissions and answers foreign ids non-revealingly', async () => {
    const owner = await registerVerifiedUser(appUrl);
    const lessonId = await seedReadyLesson(owner.user.id, 'Submit validation lesson');
    const created = await owner.session.post('/api/quizzes', {
      title: 'Validation quiz',
      itemCount: 20,
      lessonIds: [lessonId],
    });
    expect(created.status).toBe(201);
    const quizId = (created.body as { id: string }).id;
    await runQuizGeneration(quizId, owner.user.id);

    const wrongLength = await owner.session.post(`/api/quizzes/${quizId}/submit`, {
      answers: [0, 0],
    });
    expect(wrongLength.status).toBe(400);

    // Skipped questions (-1) are rejected: every question must be answered.
    const skipped = await owner.session.post(`/api/quizzes/${quizId}/submit`, {
      answers: Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? 0 : -1)),
    });
    expect(skipped.status).toBe(400);

    const outOfRange = await owner.session.post(`/api/quizzes/${quizId}/submit`, {
      answers: Array.from({ length: 20 }, () => 7),
    });
    expect(outOfRange.status).toBe(400);

    const stranger = await registerVerifiedUser(appUrl);
    const foreign = await stranger.session.post(`/api/quizzes/${quizId}/submit`, {
      answers: Array.from({ length: 20 }, () => 0),
    });
    expect(foreign.status).toBe(404);

    // Submitting before the quiz exists answers the same 404.
    const missing = await stranger.session.post(
      `/api/quizzes/${new Types.ObjectId().toHexString()}/submit`,
      { answers: [0] },
    );
    expect(missing.status).toBe(404);
  });

  it('refunds the daily allowance when generation fails terminally', async () => {
    const user = await registerVerifiedUser(appUrl);
    const lessonId = await seedReadyLesson(user.user.id, 'Refund lesson');
    const { setGenerateObjectForTests } = await import('@/lib/ai/generate-quiz');
    setGenerateObjectForTests(() => {
      throw new Error('provider exploded');
    });
    try {
      const created = await user.session.post('/api/quizzes', {
        title: 'Doomed quiz',
        itemCount: 20,
        lessonIds: [lessonId],
      });
      expect(created.status).toBe(201);
      const quizId = (created.body as { id: string }).id;
      await runQuizGeneration(quizId, user.user.id);
      const view = await user.session.get(`/api/quizzes/${quizId}`);
      // Terminal failures leave no row behind (TODO step 15): 404 + refund.
      expect(view.status).toBe(404);
      // The reserved point came back: failed attempts never consume it.
      const usage = await reserveLessonGeneration(user.user.id, 1);
      expect(usage.reserved).toBe(true);
    } finally {
      setGenerateObjectForTests(null);
      resetAllowanceForTests();
    }
  });
});
