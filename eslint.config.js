export default [
  {
    files: ["src/**/*.mjs", "scripts/**/*.mjs", "test/**/*.mjs"],
    ignores: ["node_modules/**", "coverage/**"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: "error",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        alert: "readonly",
        document: "readonly",
        fetch: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        history: "readonly",
        location: "readonly",
        navigator: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "error",
      "no-undef": "error",
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: "error",
    },
  },
];
