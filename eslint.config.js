import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'docs/**', '.remember/**'],
  },
  tseslint.configs.recommended,
);
