import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // 3D scene layer: react-hooks/immutability forbids mutating hook results,
    // but Three.js integration requires updating the live scene and camera
    // returned by useThree(). The error class this rule targets does not apply
    // here, so disable it only in this folder.
    files: ["src/components/scene/**"],
    rules: { "react-hooks/immutability": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Text-reading engine files copied from node_modules by tools/copy-ocr.mjs (minified, third-party).
    "public/ocr/**",
  ]),
]);

export default eslintConfig;
