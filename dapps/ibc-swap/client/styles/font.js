import localFont from 'next/font/local';

// google/fonts at b31870aff700ab7a1d74fa0c6887d95beb9e0037, ofl/manrope.
// Keep the SIL Open Font License with the bundled font.
export const manrope = localFont({
  src: './fonts/Manrope.ttf',
  weight: '200 800',
  display: 'swap',
});
