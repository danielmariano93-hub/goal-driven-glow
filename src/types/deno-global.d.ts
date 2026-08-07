// Alguns módulos compartilhados das Edge Functions são importados pelos testes
// do app. Esta declaração existe apenas para o typecheck do bundler — o runtime
// real continua sendo o Deno das Edge Functions.
declare const Deno: {
  env: { get(key: string): string | undefined };
};
