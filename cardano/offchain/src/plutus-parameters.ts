import { apply_params_to_script } from "@lucid-evolution/uplc";
import {
  applyDoubleCborEncoding,
  Data,
  type Exact,
  fromHex,
  toHex,
} from "@lucid-evolution/lucid";

/** Apply parameters without the older JavaScript decoder's builtin-tag limit. */
export function applyPlutusParameters<T extends unknown[] = Data[]>(
  script: string,
  params: Exact<[...T]>,
  type?: T,
): string {
  const parameters: Data = type
    ? Data.castTo(params as Exact<T>, type)
    : params as unknown as Data;
  return applyDoubleCborEncoding(
    toHex(
      apply_params_to_script(fromHex(Data.to(parameters)), fromHex(script)),
    ),
  );
}
