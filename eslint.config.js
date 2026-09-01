'use strict';

const globals = require('globals');

module.exports = [
  {
    ignores: [
      '.cache/**',
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'src/pokeclicker-master/docs/libs/**',
    ],
  },
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-useless-catch': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/pokeclicker-master/docs/setup.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
