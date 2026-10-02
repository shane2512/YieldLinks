const path = require("path");

const buildNextEslintCommand = (filenames) =>
  `yarn workspace @sh/nextjs eslint --fix --max-warnings=0 ${filenames
    .map((f) => path.relative(path.join("packages", "nextjs"), f))
    .join(" ")}`;

const checkTypesNextCommand = () => "yarn next:check-types";

// Whole-package checks (not per file): formatting, then the test suite, whenever contracts or scripts change.
const foundryChecks = () => ["yarn foundry:lint", "yarn foundry:test"];

module.exports = {
  "packages/nextjs/**/*.{ts,tsx}": [
    buildNextEslintCommand,
    checkTypesNextCommand,
  ],
  "packages/foundry/**/*.{sol,js}": foundryChecks,
};
