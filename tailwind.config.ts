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
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6", // Keeping Blue as base but allowing shifts
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        slate: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
        },
        // Semantic aliases
        brand: {
          DEFAULT: "#2563eb", // Blue 600
          hover: "#1d4ed8",   // Blue 700
          light: "#dbeafe",   // Blue 100
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
          50: "#F8FAFC", // Cool gray tint
          100: "#F1F5F9",
        },
        text: {
          900: "#1E293B", // Dark Slate Blue
          700: "#334155",
          500: "#64748B",
          300: "#CBD5E1",
        },
      },
      fontFamily: {
        sans: ['"Pretendard"', '"Inter"', "sans-serif"],
      },
      fontSize: {
        // Shifting scroll up: base is now what used to be roughly lg, etc if desired.
        // But for standard implementation, we will just use larger classes.
        // Let's add a specialized 't-base' if needed, generally 'text-base' is 16px.
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "scale-up": "scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)", // Apple-like spring/ease
        "slide-up": "slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        scaleUp: {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      boxShadow: {
        'glass': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.3) inset',
      }
    },
  },
  plugins: [],
};
export default config;

