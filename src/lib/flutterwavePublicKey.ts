type NextDataRuntimeConfig = {
  NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY?: string;
  publicRuntimeConfig?: {
    NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY?: string;
  };
};

type NextDataWindow = Window & {
  __NEXT_DATA__?: {
    runtimeConfig?: NextDataRuntimeConfig;
  };
  NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY?: string;
};

export function resolveFlutterwavePublicKey(): string {
  const publicKey =
    (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY : undefined) ||
    "FLWPUBK-018120126482dbcd065a67ebbbd8be37-X";
  const viteKey = (import.meta.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY as string | undefined) ?? undefined;
  const windowKey =
    typeof window !== "undefined"
      ? (window as NextDataWindow).NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY
      : undefined;
  const runtimeConfigKey =
    typeof window !== "undefined"
      ? (window as NextDataWindow).__NEXT_DATA__?.runtimeConfig?.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY
      : undefined;
  const nestedRuntimeConfigKey =
    typeof window !== "undefined"
      ? (window as NextDataWindow).__NEXT_DATA__?.runtimeConfig?.publicRuntimeConfig?.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY
      : undefined;

  console.log("Direct process.env check:", publicKey);
  console.log("Vite import.meta.env check:", viteKey);
  console.log("Window fallback check:", windowKey);
  console.log("Window __NEXT_DATA__.runtimeConfig check:", runtimeConfigKey);
  console.log("Window __NEXT_DATA__.publicRuntimeConfig check:", nestedRuntimeConfigKey);

  return String(
    publicKey ?? viteKey ?? windowKey ?? runtimeConfigKey ?? nestedRuntimeConfigKey ?? "",
  ).trim();
}
