module.exports = {
  content: ["./views/**/*.ejs", "./public/**/*.html", "./public/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        app: {
          navy: "#0b3b8c",

          pageBg: "#e6f2fd",
          tileOuter: "#456caf",
          tileInner: "#6a89bf",
          tileHover: "#8da1c3",

          linkOnLight: "#0982cb",
          linkOnDark: "#cadfff",

          textOnDark: "#ffffff",

          statusDone: "#687da1",
          statusPlanning: "#bea5d1",
          statusNoGift: "#684a7f",

          calOutside: "#47679f",
        },
      },

      borderRadius: {
        app: "14px",
      },

      boxShadow: {
        app: "0 6px 16px rgba(15, 23, 42, 0.15)",
      },

      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
