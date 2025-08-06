import { z } from 'zod';

export const reviewIssueSchema = z.object({
  type: z.enum(['bug', 'security', 'performance', 'style', 'maintainability', 'testing'], {
    description: 'Type of issue identified',
  }),
  severity: z.enum(['critical', 'high', 'medium', 'low'], {
    description: 'Severity level of the issue',
  }),
  title: z
    .string()
    .max(100, 'Title must be 100 characters or less')
    .describe('Short description of the issue'),
  description: z.string().describe('Detailed explanation of the issue'),
  file: z.string().describe('File path where issue is located'),
  line: z.number().int().positive().optional().describe('Line number (if applicable)'),
  confidence: z.number().min(0.0).max(1.0).describe('Confidence score (0.0-1.0)'),
  confidence_reasoning: z.string().describe('Explanation for confidence score'),
  suggestion: z.string().describe('Recommended fix or improvement'),
});

export const reviewPositiveAspectSchema = z.object({
  title: z.string().max(100, 'Title must be 100 characters or less').describe('What was done well'),
  description: z.string().describe('Explanation of the good practice'),
});

export const reviewSuggestionSchema = z.object({
  type: z.enum(['improvement', 'refactor', 'testing', 'documentation'], {
    description: 'Type of suggestion',
  }),
  title: z
    .string()
    .max(100, 'Title must be 100 characters or less')
    .describe('Enhancement suggestion'),
  description: z.string().describe('How to improve the code'),
  priority: z.enum(['high', 'medium', 'low'], {
    description: 'Priority level',
  }),
});

export const reviewOutputSchema = z.object({
  summary: z.string().describe('Overall assessment of changes'),
  confidence: z.number().min(0.0).max(1.0).describe('Overall confidence in review'),
  confidence_reasoning: z.string().describe('Explanation for overall confidence'),
  issues: z.array(reviewIssueSchema).describe('Issues identified in the code'),
  positive_aspects: z.array(reviewPositiveAspectSchema).describe('Positive aspects noted'),
  suggestions: z.array(reviewSuggestionSchema).describe('Suggestions for improvement'),
});

export type ReviewIssue = z.infer<typeof reviewIssueSchema>;
export type ReviewPositiveAspect = z.infer<typeof reviewPositiveAspectSchema>;
export type ReviewSuggestion = z.infer<typeof reviewSuggestionSchema>;
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
