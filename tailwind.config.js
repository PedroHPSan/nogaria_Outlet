import plugin from "tailwindcss/plugin";
import defaultTheme from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // Identidade Nogária Outlet: azul da marca + laranja Outlet. O cinza padrão vira um cinza-azulado
      // (as telas existentes herdam a paleta sem trocar classe por classe).
      colors: {
        brand: { DEFAULT: "#02477E", deep: "#04284A", mist: "#E6EFF7" },
        gray: {
          50: "#F3F6FA", 100: "#E9EEF4", 200: "#E3E8EF", 300: "#D3DCE6", 400: "#8A9BB0",
          500: "#5B6B80", 600: "#44546A", 700: "#2A4160", 800: "#0F3A63", 900: "#04284A",
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', ...defaultTheme.fontFamily.sans],
        mono: ['"JetBrains Mono Variable"', ...defaultTheme.fontFamily.mono],
      },
      // Sombras azuladas e suaves.
      boxShadow: {
        sm: "0 1px 2px rgba(4,40,74,.06)",
        DEFAULT: "0 1px 2px rgba(4,40,74,.06), 0 6px 16px -8px rgba(4,40,74,.16)",
        md: "0 1px 2px rgba(4,40,74,.06), 0 10px 22px -10px rgba(4,40,74,.2)",
        lg: "0 2px 4px rgba(4,40,74,.06), 0 16px 32px -12px rgba(4,40,74,.26)",
        xl: "0 4px 8px rgba(4,40,74,.08), 0 24px 44px -14px rgba(4,40,74,.32)",
      },
    },
  },
  plugins: [
    // Variantes de desktop: valem só em telas largas E com a visão desktop ligada (o interruptor
    // põe a classe `layout-mobile` no <html>). Abaixo de 1024px ou com o interruptor desligado, nada muda.
    plugin(({ addVariant }) => {
      addVariant("desk", "@media (min-width: 1024px) { html:not(.layout-mobile) & }");
      addVariant("desk-xl", "@media (min-width: 1280px) { html:not(.layout-mobile) & }");
    }),
  ],
};
