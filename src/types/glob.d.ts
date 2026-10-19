declare module 'glob' {
  export function glob(pattern: string, options?: any): Promise<string[]>;
  export default glob;
}