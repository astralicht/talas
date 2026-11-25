/**
 * Staged lesson-generation prompts (TODO step 18), re-exported from the main
 * prompts module so callers have a single import surface per concern.
 */
export {
  buildOutlineSystemPrompt,
  buildOutlinePrompt,
  buildSectionSystemPrompt,
  buildSectionPrompt,
  buildQuizCallSystemPrompt,
  buildQuizCallPrompt,
  STAGED_LESSON_PROMPT_VERSION,
} from './prompts';
