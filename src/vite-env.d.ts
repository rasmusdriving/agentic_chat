/// <reference types="vite/client" />

declare module '*.html?url' {
  const value: string
  export default value
} 