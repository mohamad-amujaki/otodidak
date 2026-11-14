export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const lessonSourceKinds = [
  'article',
  'video',
  'documentation',
  'course',
  'paper',
  'book',
  'other',
] as const;

export const generatorTools = {
  roadmap: {
    name: 'build_learning_roadmap',
    description:
      'Create a focused, sequential learning roadmap for a topic. Return only the structured tool arguments.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'chapters'],
      properties: {
        title: { type: 'string' },
        audience: { type: 'string' },
        governingThought: { type: 'string' },
        runningCase: { type: 'string' },
        chapters: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'summary', 'lessons'],
            properties: {
              title: { type: 'string' },
              summary: { type: 'string' },
              keyQuestion: { type: 'string' },
              lessons: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['title', 'objective'],
                  properties: {
                    title: { type: 'string' },
                    objective: { type: 'string' },
                    keyMessage: { type: 'string' },
                    coreConcept: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  lesson: {
    name: 'write_subchapter_lesson',
    description:
      'Write one substantial Markdown lesson for a subchapter, plus its concept, case, diagram, and source data.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['markdown', 'sources'],
      properties: {
        markdown: { type: 'string' },
        adds: { type: 'string' },
        buildsOn: {
          type: 'array',
          maxItems: 6,
          items: { type: 'string' },
        },
        concepts: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['term', 'gloss'],
            properties: {
              term: { type: 'string' },
              gloss: { type: 'string' },
            },
          },
        },
        case: {
          type: 'object',
          additionalProperties: false,
          required: ['role', 'numbers', 'artifact', 'dilemma'],
          properties: {
            role: { type: 'string' },
            numbers: { type: 'string' },
            artifact: { type: 'string' },
            dilemma: { type: 'string' },
          },
        },
        diagrams: {
          type: 'array',
          maxItems: 2,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['after', 'kind', 'title', 'nodes'],
            properties: {
              after: { type: 'integer', minimum: 1, maximum: 20 },
              kind: {
                type: 'string',
                enum: ['steps', 'hierarchy', 'compare', 'flow'],
              },
              title: { type: 'string' },
              nodes: {
                type: 'array',
                minItems: 2,
                maxItems: 8,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['label'],
                  properties: {
                    label: { type: 'string' },
                    detail: { type: 'string' },
                  },
                },
              },
              edges: {
                type: 'array',
                maxItems: 12,
                items: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 2,
                  items: { type: 'integer', minimum: 0, maximum: 7 },
                },
              },
            },
          },
        },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'url', 'title', 'kind'],
            properties: {
              id: { type: 'string' },
              url: { type: 'string' },
              title: { type: 'string' },
              publisher: { type: 'string' },
              kind: { type: 'string', enum: [...lessonSourceKinds] },
            },
          },
        },
      },
    },
  },
  quiz: {
    name: 'write_repeatable_quiz',
    description:
      'Write a repeatable multiple-choice assessment grounded in the supplied material. Return only the structured tool arguments.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['stem', 'choices', 'correct_index', 'explanation'],
            properties: {
              stem: { type: 'string' },
              choices: {
                type: 'array',
                minItems: 4,
                maxItems: 4,
                items: { type: 'string' },
              },
              correct_index: { type: 'integer', minimum: 0, maximum: 3 },
              explanation: { type: 'string' },
            },
          },
        },
      },
    },
  },
  outlineLesson: {
    name: 'suggest_outline_lesson',
    description:
      'Suggest one new lesson that fills a substantive gap in the chapter. Return only the structured tool arguments.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'objective'],
      properties: {
        title: { type: 'string' },
        objective: { type: 'string' },
        keyMessage: { type: 'string' },
        coreConcept: { type: 'string' },
      },
    },
  },
} satisfies Record<string, ToolDefinition>;
