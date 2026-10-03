import next from "eslint-config-next/core-web-vitals";
import base from "./base.js";

/**
 * Next.js flat config. `next lint` was removed in Next 16; this config is
 * consumed directly by the `eslint` CLI.
 */
export default [...base, ...next];
