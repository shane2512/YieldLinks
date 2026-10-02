const path = require("path");

const buildNextEslintCommand = (filenames) =>
  `yarn workspace @sh/nextjs eslint --fix --max-warnings=0 ${filenames
    .map((f) => path.relative(path.join("packages", "nextjs"), f))
    .join(" ")}`;

const checkTypesNextCommand = () => "yarn next:check-types";

module.exports = {
  "packages/nextjs/**/*.{ts,tsx}": [
    buildNextEslintCommand,
    checkTypesNextCommand,
  ],
};
