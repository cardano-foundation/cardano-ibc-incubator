import { BigNum } from "@emurgo/cardano-serialization-lib-browser";
import { Big } from "big.js";

export function lovelaceToAda(lovelace: BigNum): Big {
  let lovelaceJs = new Big(lovelace.to_str());
  return lovelaceJs.div("1e6");
}

export function bindInput(
  fn: (val: string) => void,
): preact.JSX.InputEventHandler<HTMLInputElement | HTMLTextAreaElement> {
  return (ev) => fn(ev.currentTarget.value);
}

export function bindInputNum(
  curVal: string,
  fn: (val: string) => void,
): preact.JSX.InputEventHandler<HTMLInputElement | HTMLTextAreaElement> {
  return (ev) => {
    let newVal = ev.currentTarget.value;
    if (/^[0-9]*(\.[0-9]*)?$/.test(newVal)) {
      fn(newVal);
    } else {
      let input = ev.currentTarget;
      let selectionStart = input.selectionStart;
      let selectionEnd = input.selectionEnd;
      input.value = curVal;
      if (selectionStart != null && selectionStart == selectionEnd) {
        input.selectionStart = selectionStart - 1;
        input.selectionEnd = selectionEnd - 1;
      } else {
        input.selectionStart = selectionStart;
        input.selectionEnd = selectionEnd;
      }
    }
  };
}

export function ellipsizeMiddle(
  s: string,
  startChars: number,
  endChars: number,
): string {
  return s.slice(0, startChars) + "..." + s.slice(s.length - endChars);
}
