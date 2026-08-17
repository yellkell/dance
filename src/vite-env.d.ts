/// <reference types="vite/client" />

// Audio masters imported for their URL (see audio/tracks.ts). Vite knows
// .mp3 natively; .m4a is declared here alongside it so both are typed.
declare module '*.m4a' {
  const src: string;
  export default src;
}

// The house typeface (see ui/fonts.ts), imported for its URL the same way.
declare module '*.woff2' {
  const src: string;
  export default src;
}
