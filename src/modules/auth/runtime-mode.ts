import { env } from "node:process";

export function isDeterministicTestEnvironment(environment: NodeJS.ProcessEnv): boolean {
  return environment.NODE_ENV === "test" || (
    environment.NODE_ENV === "development" && environment.LEDGERHARBOUR_TEST_MODE === "true"
  );
}

export function isDeterministicTestRuntime(): boolean {
  return isDeterministicTestEnvironment(env);
}
