import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
        },
        secondary: {
          500: "#6B7280",
          600: "#4B5563",
        },
        success: {
          500: "#10B981",
          600: "#059669",
        },
        warning: {
          500: "#F59E0B",
          600: "#D97706",
        },
        error: {
          500: "#EF4444",
          600: "#DC2626",
        },
        surface: {
          0: "#FFFFFF",
          50: "#F9FAFB",
          100: "#F3F4F6",
        },
        text: {
          900: "#111827",
          700: "#374151",
          500: "#6B7280",
          300: "#D1D5DB",
        },
      },
    },
  },
  plugins: [],
};
export default config;

