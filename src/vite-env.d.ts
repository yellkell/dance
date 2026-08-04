/// <reference types="vite/client" />

// Audio masters imported for their URL (see audio/tracks.ts). Vite knows
// .mp3 natively; .m4a is declared here alongside it so both are typed.
declare module '*.m4a' {
  const src: string;
  export default src;
}
