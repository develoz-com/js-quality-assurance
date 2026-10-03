import reactHooks from "eslint-plugin-react-hooks";
import base from "./base.js";

/**
 * React flat config. Bundles the React Compiler rule set that ships with
 * eslint-plugin-react-hooks v7. Do not add eslint-plugin-react-compiler separately.
 */
export default [...base, reactHooks.configs["recommended-latest"]];
