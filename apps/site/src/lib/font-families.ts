/** Families self-hosted by fonts.ts. */
export const bundledFamilies = ['Gabriela', 'Onest'] as const;

/** Generic fallback stacks for each self-hosted family. */
export const familyFallbacks = {
  Gabriela: 'Georgia,serif',
  Onest: 'system-ui,sans-serif',
} satisfies Record<(typeof bundledFamilies)[number], string>;
