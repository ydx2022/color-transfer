/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 900: "#0B0F1A", 800: "#141A26", 700: "#1E2638" },
        brand: { 500: "#3B82F6", 600: "#2563EB", 700: "#1D4ED8" },
        ok: "#22C55E",
        warn: "#F59E0B",
        bad: "#EF4444"
      },
      fontFamily: {
        sans: ["PingFang SC", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};
