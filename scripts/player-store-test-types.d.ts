declare module 'cc' {
  export const sys: {
    localStorage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
      clear(): void;
    };
  };
}

declare const process: {
  stdout: { write(value: string): void };
};
