/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"]
      },
      colors: {
        paper: "#f6f7f2",
        ink: "#24302f",
        moss: "#60735f",
        clay: "#c98564",
        skysoft: "#d8e8ef"
      },
      boxShadow: {
        soft: "0 16px 50px rgba(36, 48, 47, 0.12)"
      }
    }
  },
  plugins: []
};
