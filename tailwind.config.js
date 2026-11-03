import plugin from "tailwindcss/plugin";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: { extend: {} },
  plugins: [
    // Variantes de desktop: valem só em telas largas E com a visão desktop ligada (o interruptor
    // põe a classe `layout-mobile` no <html>). Abaixo de 1024px ou com o interruptor desligado, nada muda.
    plugin(({ addVariant }) => {
      addVariant("desk", "@media (min-width: 1024px) { html:not(.layout-mobile) & }");
      addVariant("desk-xl", "@media (min-width: 1280px) { html:not(.layout-mobile) & }");
    }),
  ],
};
