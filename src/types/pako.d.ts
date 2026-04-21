declare module 'pako' {
  export function inflate(data: any, options?: any): any;
  export function deflate(data: any, options?: any): any;
  export default {
    inflate,
    deflate
  };
}
