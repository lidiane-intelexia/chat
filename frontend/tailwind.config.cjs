module.exports = {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0b0b12',
          800: '#131322',
          700: '#1c1c30'
        },
        neon: {
          500: '#28f2c0',
          600: '#18c99f'
        },
        ember: {
          500: '#ff7a59',
          600: '#e9643f'
        }
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Sora"', 'sans-serif']
      },
      boxShadow: {
        glow: '0 0 35px rgba(40, 242, 192, 0.25)'
      }
    }
  },
  plugins: []
};
