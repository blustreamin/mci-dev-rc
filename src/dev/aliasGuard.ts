
if ((import.meta as any).env.DEV) {
  // Simple guard to check if untransformed aliases are leaking to browser
  // This will throw if the browser sees '@/' which means Vite didn't resolve it
  const guard = (path: string) => {
      if (path.startsWith('@/')) {
          console.error(`[AliasGuard] Failed to resolve module specifier "${path}". Check vite.config.ts alias.`);
      }
  };
}