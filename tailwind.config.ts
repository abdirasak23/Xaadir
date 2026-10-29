import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        mint: "#f0f0f1",
        forest: "#111111",
        canvas: "#f5f5f6",
      },
      boxShadow: {
        card: "0 8px 28px rgba(23, 36, 32, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
