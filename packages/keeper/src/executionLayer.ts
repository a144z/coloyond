export type ExecutionProviderId = "magicblock" | "tuktuk" | "manual-poke";

export type ExecutionProvider = {
  id: ExecutionProviderId;
  priority: number;
  needsExternalCrank: boolean;
  recurring: boolean;
};

export const EXECUTION_PROVIDERS: readonly ExecutionProvider[] = [
  { id: "magicblock", priority: 1, needsExternalCrank: true, recurring: true },
  { id: "tuktuk", priority: 2, needsExternalCrank: true, recurring: true },
  { id: "manual-poke", priority: 3, needsExternalCrank: false, recurring: false },
];

export type ExecutionSelection = {
  provider: ExecutionProvider;
  fallback: ExecutionProvider | null;
  reason: string;
};

export function isExecutionProviderId(value: string): value is ExecutionProviderId {
  return EXECUTION_PROVIDERS.some((provider) => provider.id === value);
}

export function executionProvider(id: ExecutionProviderId): ExecutionProvider {
  const provider = EXECUTION_PROVIDERS.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`Unknown execution provider: ${id}`);
  return provider;
}

export function selectExecutionProvider(admitted: readonly string[] = []): ExecutionSelection {
  for (const value of admitted) {
    if (!isExecutionProviderId(value)) throw new Error(`Unknown execution provider admission: ${value}`);
  }
  const manual = executionProvider("manual-poke");
  const admittedProvider = EXECUTION_PROVIDERS
    .filter((provider) => provider.id !== "manual-poke" && admitted.includes(provider.id))
    .sort((left, right) => left.priority - right.priority)[0];
  if (!admittedProvider) return { provider: manual, fallback: null, reason: "No recurring provider admitted; permissionless manual poke is the fallback" };
  return { provider: admittedProvider, fallback: manual, reason: `${admittedProvider.id} is the highest-priority admitted recurring provider` };
}

export function executionSelectionFromEnvironment(env: NodeJS.ProcessEnv = process.env): ExecutionSelection {
  const text = env.COLOYOND_KEEPER_EXECUTION_PROVIDER?.trim() ?? "";
  const admitted = text.length === 0 ? [] : [...new Set(text.split(",").map((value) => value.trim()).filter((value) => value.length > 0))];
  return selectExecutionProvider(admitted);
}
