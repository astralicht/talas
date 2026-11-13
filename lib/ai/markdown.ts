import type { GeneratedLesson } from './lesson-schema';

function normalizeHeading(value: string): string {
  return value.replace(/^#+\s*/, '').trim();
}

/**
 * Converts the validated model object into Markdown with a stable shape so the
 * same input always produces byte-identical lesson content.
 */
export function lessonToMarkdown(lesson: GeneratedLesson): string {
  const lines: string[] = [`# ${normalizeHeading(lesson.title)}`, '', `> ${lesson.summary.trim()}`, ''];

  if (lesson.learningObjectives && lesson.learningObjectives.length > 0) {
    lines.push('## Learning objectives', '');
    for (const objective of lesson.learningObjectives) {
      lines.push(`- ${objective.trim()}`);
    }
    lines.push('');
  }

  for (const section of lesson.sections) {
    lines.push(`## ${normalizeHeading(section.heading)}`, '', section.contentMarkdown.trim(), '');
    if (section.keyPoints && section.keyPoints.length > 0) {
      lines.push('### Key points', '');
      for (const point of section.keyPoints) {
        lines.push(`- ${point.trim()}`);
      }
      lines.push('');
    }
    if (section.misconceptions && section.misconceptions.length > 0) {
      lines.push('### Common misconceptions', '');
      for (const misconception of section.misconceptions) {
        lines.push(`- ${misconception.trim()}`);
      }
      lines.push('');
    }
    if (section.checkUnderstanding && section.checkUnderstanding.length > 0) {
      lines.push('### Check your understanding', '');
      for (const question of section.checkUnderstanding) {
        lines.push(`- ${question.trim()}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}
