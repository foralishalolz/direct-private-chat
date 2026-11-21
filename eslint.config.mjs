import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      /**
       * The React Compiler lint added in this toolchain flags any `setState`
       * inside `useEffect`. The remaining occurrences are deliberate, well
       * scoped synchronization effects:
       *
       *  - bottom sheets re-seeding their form fields from the record being
       *    edited whenever they open,
       *  - reading the current URL query / localStorage once on mount,
       *  - refreshing a small local cache after a realtime event.
       *
       * Kept at "warn" (not off) so new violations stay visible in review.
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
