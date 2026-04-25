import type { Config } from "tailwindcss";

// Tokens here mirror docs/skool-success-os-master-plan.md Part 6 and
// docs/mockups/. If a token below disagrees with the V2 mockup, the
// mockup wins — update this file rather than the mockup.
const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: "#fafaf7", // warm off-white background
        cream: "#fff9e8", // Skool-inspired highlight
        ink: "#1f1d1b", // primary text
        muted: "#6b6660", // secondary text
        rule: "#ece8e1", // hairline borders
        // Accents
        terracotta: {
          DEFAULT: "#d97757", // softer terracotta accent
          ink: "#a44a30", // text on cream
          soft: "#f4d6c5", // wash backgrounds
        },
        forest: {
          DEFAULT: "#2f7d4a", // healthy completion / retention
          soft: "#dff0e3",
        },
      },
      fontFamily: {
        // Headlines: Fraunces (loaded via next/font in src/app/layout.tsx)
        serif: ["var(--font-fraunces)", "ui-serif", "Georgia", "serif"],
        // Body: system stack
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "0.75rem",
      },
      boxShadow: {
        card: "0 1px 0 rgba(0,0,0,0.02), 0 1px 2px rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
