export default {
  '*.{ts,tsx,js,jsx,mjs,cjs}': [
    'eslint --max-warnings=0 --no-warn-ignored --fix',
    'prettier --write',
  ],
  '*.{css,scss}': ['stylelint --max-warnings=0 --fix', 'prettier --write'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
