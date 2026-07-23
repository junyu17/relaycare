// ESLint flat config for RelayCare MVP.
// Composes the Expo base config (JSX + TypeScript + platform globals) with
// project-local ignores. The Expo base already configures @typescript-eslint,
// React, and import rules; we keep customizations minimal to stay on the
// supported upgrade path.
const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  {
    ignores: ["node_modules/", "web-build/", "dist/", ".expo/", "coverage/", "docs/"]
  },
  expoConfig
]);
