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

  for (const section of lesson.sections) {
    lines.push(`## ${normalizeHeading(section.heading)}`, '', section.contentMarkdown.trim(), '');
    if (section.keyPoints && section.keyPoints.length > 0) {
      lines.push('### Key points', '');
      for (const point of section.keyPoints) {
        lines.push(`- ${point.trim()}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}
